// -*- js-indent: 2 -*-
var amqp = require('amqplib');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream');

var Readable = Stream.Readable || require('readable-stream/readable');
var Writable = Stream.Writable || require('readable-stream/writable');
var Duplex   = Stream.Duplex   || require('readable-stream/duplex');

var debug = (process.env['DEBUG']) ?
    function(msg) { util.debug(msg) } : function() {};

var info = util.log;

debug('on');

// A default value to substitute when we don't get a callback
function ignore() {}

// Do the tedious string-or-buffer conversion
function bufferify(chunk, encoding) {
  return (typeof chunk === 'string')
    ? new Buffer(chunk, encoding || 'utf8')
    : chunk;
}

function Context(url) {
  EventEmitter.call(this);
  var that = this;
  var c = this._connection = amqp.connect(url);
  c.then(this.emit.bind(this, 'ready'),
         this.emit.bind(this, 'error'));
  c.then(function(conn) {
    c.on('error', function(e) {
      that.emit('error', e);
      that.emit('close');
    });
  });
};
util.inherits(Context, EventEmitter);

var SOCKETS = {
  PUB: PubSocket,
  SUB: SubSocket,
  PUSH: PushSocket,
  PULL: PullSocket,
  REQ: ReqSocket,
  REP: RepSocket
};

Context.prototype.socket = function(type) {
  var Ctr = SOCKETS[type];
  if (Ctr) {
    var s = new Ctr(this._connection.then(function(c) {
      return c.createChannel();
    }));
    return s;
  }
  else throw('Undefined socket type ' + type);
};

Context.prototype.close = function(callback) {
  this._connection.then(function(c) {
    c.close().then(callback || ignore);
  });
};

module.exports.Context = Context;

// Because we may have to wait on the channel being opened (and other
// things), each method dependent on the channel is patched to one
// that synchronises on `ready` then unpatches all of the methods (and
// calls the unpatched version). The methods must all be unpatched in
// the same tick, so that they don't get re-ordered.
function patch(self, ready, methods) {
  methods.forEach(function(method) {
    if (self[method] && !self.hasOwnProperty(method)) {
      self[method] = function() {
        var args = arguments;
        ready.then(function() {
          methods.forEach(function(method) {delete self[method];});
          self[method].apply(self, args);
        });
      };
    }
  });
}

function Socket(channel) {
  this.channel = channel;
  this.options = {};
  var self = this;
  var ready = channel.then(function(ch) { self.ch = ch; });
  patch(self, ready,
        ['_write', 'end', 'connect', 'setsockopt']);

  var self = this;

  function closeAndInvalidate(event, err) {
    this.readable = this.writable = false;
    this.emit(event, err);
  }

  var close = closeAndInvalidate.bind(this, 'close');
  var error = closeAndInvalidate.bind(this, 'error');

  channel.then(function(ch) {
    ch.on('close', close);
    ch.on('error', error);
  });
}

function end() {
  this.ch.close();
}

function setsockopt(opt, value) {
  this.options[opt] = value;
}

function addSocketMethods(Class) {
  Class.prototype.end = end;
  Class.prototype.destroy = end;
  Class.prototype.setsockopt = setsockopt;
}

function PubSocket(channel) {
  Writable.call(this);
  Socket.call(this, channel);
  this.pubs = [];
}
util.inherits(PubSocket, Writable);
addSocketMethods(PubSocket);

function decodeExchange(exchange) {
  switch (typeof exchange) {
  case 'string':
    return {exchange: exchange,
            routingKey: '',
            exchangeType: 'fanout'};
  case 'object':
    if (!exchange) return decodeExchange({});
    return {exchange: exchange.exchange || 'amq.fanout',
            routingKey: exchange.topic || '',
            exchangeType: exchange.routing || 'fanout'};
  default:
    throw new Error(
      'String or {[exchange], [topic], [routing]} expected');
  }
}

PubSocket.prototype.connect = function(destination, callback) {
  var self = this, ch = this.ch;
  var e = decodeExchange(destination);

  ch.assertExchange(e.exchange, e.exchangeType,
                    {durable: true})
    .then(function(ok) {
      self.pubs.push({exchange: e.exchange,
                      routingKey: e.routingKey});
    }).then(callback || ignore);
};

PubSocket.prototype._write = function(chunk, encoding, callback) {
  var ch = this.ch;
  var options = {expiration: this.options.expiration};
  this.pubs.forEach(function(pub) {
    ch.publish(pub.exchange, pub.routingKey,
               bufferify(chunk, encoding),
               options);
  });
  (callback || ignore)();
};

function SubSocket(channel) {
  Readable.call(this, {objectMode: true});

  var self = this;

  var setup = channel.then(function(ch) {
    return ch.assertQueue('', {
      exclusive: true, autoDelete: true
    }).then(function(ok) {
      self.queue = ok.queue; // for inspection
      return ch.consume(ok.queue, function(msg) {
        self.push(msg.content);
      }, {noAck:true, exclusive:true})
        .then(function() { return ch; });
    });
  });
  Socket.call(this, setup);
}
util.inherits(SubSocket, Readable);
addSocketMethods(SubSocket);

SubSocket.prototype.connect = function(source, callback) {
  var ch = this.ch, queue = this.queue;
  var e = decodeExchange(source);

  ch.assertExchange(e.exchange, e.exchangeType)
    .then(function() {
      return ch.bindQueue(queue, e.exchange, e.routingKey);
    }).then(callback || ignore);
};

// AMQP and the stream API don't really work well together here. I'm
// supposed to initiate reads when this method is called, then not
// push any more once I get `false` back from `#push`; but how do I do
// that with AMQP? (I guess I could use channel.flow, but that seems
// rather overwrought; or, I could use prefetch and start/stop
// acknowledging messages).
SubSocket.prototype._read = ignore;


function PushSocket(channel) {
  Writable.call(this);
  Socket.call(this, channel);
  this.queues = [];
}
util.inherits(PushSocket, Writable);
addSocketMethods(PushSocket);

PushSocket.prototype.connect = function(destination, callback) {
  var self = this, ch = this.ch;

  ch.assertQueue(destination, {durable: true})
    .then(function(ok) {
      self.queues.push(destination);
    }).then(callback || ignore);
};

PushSocket.prototype._write = function(chunk, encoding, callback) {
  var queue = this.queues.shift();
  if (queue !== undefined) {
    this.queues.push(queue);

    var options = {expiration: this.options.expiration};
    this.ch.sendToQueue(queue, bufferify(chunk, encoding), options);
  }
  (callback || ignore)();
};


function PullSocket(channel) {
  Readable.call(this, {objectMode: true});
  Socket.call(this, channel);
}
util.inherits(PullSocket, Readable);
addSocketMethods(PullSocket);

PullSocket.prototype.connect = function(source, callback) {
  var self = this, ch = this.ch;

  ch.prefetch(1);
  ch.assertQueue(source).then(function(ok) {
    return ch.consume(source, function(msg) {
      self.push(msg.content);
      ch.ack(msg);
    }, {noAck:false});
  }).then(callback || ignore);
};

PullSocket.prototype._read = ignore;


function ReqSocket(channel) {
  Duplex.call(this, {objectMode:true});
  this.queues = [];
  this.reply = null;

  var self = this;

  var setup = channel.then(function(ch) {
    return ch.assertQueue('', {exclusive:true, autoDelete:true})
      .then(function(ok) {
        self.reply = ok.queue;
        return ch.consume(ok.queue, function(msg) {
          self.push(msg.content);
          ch.ack(msg);
        }, {noAck:false, exclusive: true})
          .then(function() { return ch; });
      });
  });

  Socket.call(this, setup);
}
util.inherits(ReqSocket, Duplex);
addSocketMethods(ReqSocket);

ReqSocket.prototype.connect = function(destination, callback) {
  var self = this, ch = this.ch;
  ch.assertQueue(destination).then(function(ok) {
    self.queues.push(ok.queue);
  }).then(callback || ignore);
};

ReqSocket.prototype._write = function(chunk, encoding, callback) {
  var ch = this.ch, reply = this.reply;

  var queue = this.queues.shift();
  if (queue) {
    this.queues.push(queue);
    var options = {replyTo: reply, deliveryMode: true,
                   expiration: this.options.expiration};
    ch.sendToQueue(queue, bufferify(chunk, encoding), options);
  }
  (callback || ignore)();
};

ReqSocket.prototype._read = ignore;


function RepSocket(channel) {
  Duplex.call(this, {objectMode: true});
  Socket.call(this, channel);
}
util.inherits(RepSocket, Duplex);
addSocketMethods(RepSocket);

RepSocket.prototype.connect = function(source, callback) {
  var self = this, ch = this.ch;

  ch.prefetch(1); // since no setup
  ch.assertQueue(source).then(function(ok) {
    return ch.consume(source, function(msg) {
      self.current = msg;
      self.push(msg.content);
    }, {noAck:false});
  }).then(callback || ignore);
};

RepSocket.prototype._write = function(chunk, encoding, callback) {
  var ch = this.ch, current = this.current;

  if (!current) throw new Error('Write with no pending request');
  
  var replyTo = current.properties.replyTo;
  var options = {
    deliveryMode: true,
    expiration: this.options.expiration
  };
  ch.sendToQueue(replyTo, bufferify(chunk, encoding), options);
  ch.ack(current);
  this.current = null;
  (callback || ignore)();
};

RepSocket.prototype._read = ignore;
