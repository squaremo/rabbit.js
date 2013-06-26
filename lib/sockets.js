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

function Socket(channel) {
  this.channel = channel;

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
  var self = this;
  this.channel.then(function(ch) {
    ch.close();
  });
}

function addSocketMethods(Class) {
  Class.prototype.end = end;
}

function PubSocket(channel) {
  Writable.call(this);
  Socket.call(this, channel);
  this.pubs = [];
}
util.inherits(PubSocket, Writable);
addSocketMethods(PubSocket);

PubSocket.prototype.connect = function(destination, callback) {
  var self = this;
  var exchange, routingKey, exchangeType;
  if (typeof destination === 'object') {
    exchange = destination.exchange || 'amq.fanout';
    routingKey = destination.topic || '';
    exchangeType = destination.routing || 'fanout';
  }
  else {
    exchange = destination;
    routingKey = '';
    exchangeType = 'fanout';
  }

  this.channel.then(function(ch) {
    return ch.assertExchange(exchange, exchangeType,
                             {durable: true})
      .then(function(ex) {
        self.pubs.push({exchange: exchange,
                        routingKey: routingKey});
      });
  }).then(callback || ignore);
};

PubSocket.prototype._write = function(chunk, encoding, callback) {
  var self = this;
  this.channel.then(function(ch) {
    self.pubs.forEach(function(pub) {
      ch.publish(pub.exchange, pub.routingKey,
                 bufferify(chunk, encoding));
    });
  }).then(callback || ignore);
};


function SubSocket(channel) {
  Readable.call(this, {objectMode: true});
  Socket.call(this, channel);
}
util.inherits(SubSocket, Readable);
addSocketMethods(SubSocket);

SubSocket.prototype.connect = function(source, callback) {
  var self = this;

  var exchange, bindingKey, exchangeType;
  if (typeof source === 'object') {
    exchange = source.exchange || 'amq.fanout';
    bindingKey = source.topic || '';
    exchangeType = source.routing || 'fanout';
  }
  else {
    exchange = source;
    bindingKey = '';
    exchangeType = 'fanout';
  }

  this.channel.then(function(ch) {
    if (!self.queue) {
      self.queue = ch.assertQueue('', {
        exclusive: true, autoDelete: true
      }).then(function(ok) {
        ch.consume(ok.queue, function(msg) {
          self.push(msg.content);
        }, {noAck:true, exclusive:true});
        return ok;
      });
    }
    return self.queue.then(function(ok) {
      return ch.assertExchange(exchange, exchangeType)
        .then(function() {
          return ch.bindQueue(ok.queue, exchange, bindingKey);
        });
    });
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
  var self = this;

  this.channel.then(function(ch) {
    return ch.assertQueue(destination, {durable: true})
      .then(function(ok) {
        self.queues.push(destination);
      });
  }).then(callback || ignore);
};

PushSocket.prototype._write = function(chunk, encoding, callback) {
  var queue = this.queues.shift();

  if (queue !== undefined) {
    this.queues.push(queue);

    this.channel.then(function(ch) {
      ch.sendToQueue(queue, bufferify(chunk, encoding));
    }).then(callback || ignore);
  }
};


function PullSocket(channel) {
  Readable.call(this, {objectMode: true});
  Socket.call(this, channel);
}
util.inherits(PullSocket, Readable);
addSocketMethods(PullSocket);

PullSocket.prototype.connect = function(source, callback) {
  var self = this;

  this.channel.then(function(ch) {
    ch.prefetch(1);
    return ch.assertQueue(source).then(function(ok) {
      return ch.consume(source, function(msg) {
        self.push(msg.content);
        ch.ack(msg);
      }, {noAck:false});
    });
  }).then(callback || ignore);
};

PullSocket.prototype._read = ignore;


function ReqSocket(channel) {
  Duplex.call(this, {objectMode:true});
  Socket.call(this, channel);
  this.queues = [];
  this.reply = null;
}
util.inherits(ReqSocket, Duplex);
addSocketMethods(ReqSocket);

ReqSocket.prototype.connect = function(destination, callback) {
  var self = this;
  this.channel.then(function(ch) {
    if (!self.reply) {
      ch.prefetch(1); // do I need this?
      self.reply = ch.assertQueue('', {
        exclusive:true, autoDelete:true
      }).then(function(ok) {
        ch.consume(ok.queue, function(msg) {
          self.push(msg.content);
          ch.ack(msg);
        }, {noAck:false, exclusive: true});
        return ok.queue;
      });
    }
    return self.reply.then(function(ok) {
      return ch.assertQueue(destination).then(function(ok) {
        self.queues.push(ok.queue);
      });
    });
  }).then(callback || ignore);
};

ReqSocket.prototype._write = function(chunk, encoding, callback) {
  var self = this;

  var queue = this.queues.shift();
  if (queue) {
    this.queues.push(queue);

    this.channel.then(function(ch) {
      return self.reply.then(function(reply) {
        ch.sendToQueue(queue, bufferify(chunk, encoding),
                       {replyTo: reply, deliveryMode: true});
      });
    }).then(callback || ignore);
  }
};

ReqSocket.prototype._read = ignore;


function RepSocket(channel) {
  Duplex.call(this, {objectMode: true});
  Socket.call(this, channel);
}
util.inherits(RepSocket, Duplex);
addSocketMethods(RepSocket);

RepSocket.prototype.connect = function(source, callback) {
  var self = this;

  this.channel.then(function(ch) {
    ch.prefetch(1);
    return ch.assertQueue(source).then(function(ok) {
      return ch.consume(source, function(msg) {
        self.current = msg;
        self.push(msg.content);
      }, {noAck:false});
    });
  }).then(callback || ignore);
};

RepSocket.prototype._write = function(chunk, encoding, callback) {
  var self = this;

  if (!this.current) throw new Error('Write with no pending request');
  
  this.channel.then(function(ch) {
    var replyTo = self.current.properties.replyTo;
    ch.sendToQueue(replyTo, bufferify(chunk, encoding),
                   {deliveryMode:true});
    ch.ack(self.current);
    self.current = null;
  }).then(callback || ignore);
};

RepSocket.prototype._read = ignore;
