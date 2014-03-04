// -*- js-indent: 2 -*-
var amqp = require('amqplib');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream');
var guid = require('node-uuid').v4;

var Readable = Stream.Readable || require('readable-stream/readable');
var Writable = Stream.Writable || require('readable-stream/writable');
var Duplex   = Stream.Duplex   || require('readable-stream/duplex');

var delay = global.setImmediate || nextTick;

// A default value to substitute when we don't get a callback
function ignore() {}

// Do the tedious string-or-buffer conversion. If I was using byte
// streams, this would be done automatically; however I'm using
// streams in object mode.
function bufferify(chunk, encoding) {
  return (typeof chunk === 'string')
    ? new Buffer(chunk, encoding || 'utf8')
    : chunk;
}

function Context(url) {
  EventEmitter.call(this);
  var onError = this.emit.bind(this, 'error');
  var onClose = this.emit.bind(this, 'close');
  var c = this._connection = amqp.connect(url);
  c.then(function(conn) {
    conn.on('error', onError);
    conn.on('close', onClose);
  });
  c.then(this.emit.bind(this, 'ready'),
         onError);
};
inherits(Context, EventEmitter);

var SOCKETS = {
  PUB: PubSocket,
  SUB: SubSocket,
  PUSH: PushSocket,
  PULL: PullSocket,
  REQ: ReqSocket,
  REP: RepSocket,
  WORKER: WorkerSocket
};

Context.prototype.socket = function(type, options) {
  var Ctr = SOCKETS[type];
  if (Ctr) {
    var s = new Ctr(this._connection.then(function(c) {
      return c.createChannel();
    }), options);
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

// This is a pseudo-constructor, in that I only ever use it to
// initialise things in other constructors, to get a kind of multiple
// inheritence. The methods are transplanted to each prototype with
// `addSocketMethods`.
function Socket(setup, options) {
  var self = this;
  this.options = options = options || {};
  var ready = setup.then(function(ch) { self.ch = ch; });
  patch(self, ready,
        ['close', 'write', 'end', 'connect', 'setsockopt', 'ack']);
  // Apply any options we've been given, in case they have immediate
  // effects rather than just being consulted (e.g., prefetch).
  ready.then(function() {
    for (var opt in options) {
      self.setsockopt(opt, options[opt]);
    }
  });

  function closeAndInvalidate(event, err) {
    this.readable = this.writable = false;
    this.emit(event, err);
  }

  var close = closeAndInvalidate.bind(this, 'close');
  var error = closeAndInvalidate.bind(this, 'error');

  setup.then(function(ch) {
    ch.on('close', close);
    ch.on('error', error);
    ch.on('drain', self.emit.bind(self, 'drain'));
    ch.on('readable', self.emit.bind(self, 'readable'));
  });
}

function close() {
  this.ch.close();
}

function end(chunk, encoding) {
  if (chunk !== undefined) this.write(chunk, encoding);
  this.close();
}

function setsockopt(opt, value) {
  switch (opt) {
  case 'prefetch':
    this.ch.prefetch(value); break;
  case 'expiration':
  case 'persistent':
    this.options[opt] = value;
  }
}

function addSocketMethods(Class) {
  Class.prototype.close = close;
  Class.prototype.setsockopt = setsockopt;
}

function PubSocket(channel, opts) {
  Writable.call(this);
  Socket.call(this, channel, opts);
  this.pubs = [];
}
inherits(PubSocket, Writable);
addSocketMethods(PubSocket);
PubSocket.prototype.end = end;

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
                    {durable: false})
    .then(function(ok) {
      self.pubs.push({exchange: e.exchange,
                      routingKey: e.routingKey});
    }).then(callback || ignore);
};

PubSocket.prototype.write = function(chunk, encoding) {
  var ch = this.ch;
  var options = {expiration: this.options.expiration,
                 persistent: this.options.persistent};
  var allpubs = true;
  this.pubs.forEach(function(pub) {
    allpubs = allpubs &&
      ch.publish(pub.exchange, pub.routingKey,
                 bufferify(chunk, encoding),
                 options);
  });
  return allpubs;
};

function SubSocket(channel, opts) {
  Readable.call(this, {objectMode: true});

  var self = this;

  var setup = channel.then(function(ch) {
    return ch.assertQueue('', {
      exclusive: true, autoDelete: true
    }).then(function(ok) {
      self.queue = ok.queue; // for inspection
      return ch.consume(ok.queue, function(msg) {
        // if msg is null, this indicates a cancel, i.e., end of
        // stream. Pushing such a null tells the stream to emit 'end'.
        self.push(msg && msg.content);
      }, {noAck:true, exclusive:true})
        .then(function() { return ch; });
    });
  });
  Socket.call(this, setup, opts);
}
inherits(SubSocket, Readable);
addSocketMethods(SubSocket);

SubSocket.prototype.connect = function(source, callback) {
  var ch = this.ch, queue = this.queue;
  var e = decodeExchange(source);

  ch.assertExchange(e.exchange, e.exchangeType,
                    {durable: false})
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


function PushSocket(channel, opts) {
  Writable.call(this);
  Socket.call(this, channel, opts);
  this.queues = [];
}
inherits(PushSocket, Writable);
addSocketMethods(PushSocket);
PushSocket.prototype.end = end;

PushSocket.prototype.connect = function(destination, callback) {
  var self = this, ch = this.ch;

  ch.assertQueue(destination, {durable: this.options.persistent})
    .then(function(ok) {
      self.queues.push(destination);
    }).then(callback || ignore);
};

PushSocket.prototype.write = function(chunk, encoding) {
  var queue = this.queues.shift();
  if (queue !== undefined) {
    this.queues.push(queue);
    var options = {expiration: this.options.expiration,
                   persistent: this.options.persistent};
    return this.ch.sendToQueue(queue,
                               bufferify(chunk, encoding), options);
  }
  else return true;
};


function PullSocket(channel, opts) {
  Readable.call(this, {objectMode: true});
  Socket.call(this, channel, opts);
  this.consumers = {};
}
inherits(PullSocket, Readable);
addSocketMethods(PullSocket);

PullSocket.prototype.connect = function(source, callback) {
  var self = this, ch = this.ch;

  if (this.consumers[source]) {
    if (callback) delay(callback); return;
  }

  ch.assertQueue(source, {durable: this.options.persistent})
    .then(function(ok) {
      return ch.consume(source, function(msg) {
        self.push(msg && msg.content);
        ch.ack(msg);
      }, {noAck:false}).then(function(ok) {
        self.consumers[source] = ok.consumerTag;
      });
    }).then(callback || ignore);
};

PullSocket.prototype._read = ignore;

function WorkerSocket(channel, opts) {
  Readable.call(this, {objectMode: true});
  Socket.call(this, channel, opts);
  this.consumers = {};
  this.unacked = [];
}
inherits(WorkerSocket, Readable);
addSocketMethods(WorkerSocket);

WorkerSocket.prototype.connect = function(source, callback) {
  var self = this, ch = this.ch;

  if (this.consumers[source]) {
    if (callback) delay(callback); return;
  }

  ch.assertQueue(source, {durable: this.options.persistent})
    .then(function(ok) {
      return ch.consume(source, function(msg) {
        if (msg) self.unacked.push(msg);
        self.push(msg && msg.content);
      }, {noAck:false}).then(function(ok) {
        self.consumers[source] = ok.consumerTag;
      });
    }).then(callback || ignore);
};

WorkerSocket.prototype.ack = function() {
  var msg = this.unacked.shift();
  if (!msg) {
    throw new Error("ack called with no unacknowledged messages");
  }
  this.ch.ack(msg);
};

WorkerSocket.prototype._read = ignore;


function ReqSocket(channel, opts) {
  Duplex.call(this, {objectMode:true});
  this.queues = [];
  this.awaiting = [];
  this.replyQ = null;

  var self = this;

  var setup = channel.then(function(ch) {
    return ch.assertQueue('', {exclusive:true, autoDelete:true})
      .then(function(ok) {
        self.replyQ = ok.queue;
        return ch.consume(ok.queue, function(msg) {
          if (msg !== null) {
            self.handleReply(msg);
            ch.ack(msg);
          }
          else self.push(null);
        }, {noAck:false, exclusive: true})
          .then(function() { return ch; });
      });
  });

  Socket.call(this, setup, opts);
}
inherits(ReqSocket, Duplex);
addSocketMethods(ReqSocket);
ReqSocket.prototype.end = end;

ReqSocket.prototype.handleReply = function(msg) {
  var cid = msg.properties.correlationId;
  for (var i = 0; i < this.awaiting.length; i++) {
    if (cid === this.awaiting[i].correlationId) {
      this.awaiting[i].answer = msg.content;
    }
  }
  var lwm; while (lwm = this.awaiting[0]) {
    if (lwm.answer !== null) this.push(lwm.answer);
    else break;
    this.awaiting.shift();
  }
};

ReqSocket.prototype.connect = function(destination, callback) {
  var self = this, ch = this.ch;
  ch.assertQueue(destination, {durable: this.options.persistent})
    .then(function(ok) {
      self.queues.push(ok.queue);
    }).then(callback || ignore);
};

ReqSocket.prototype.write = function(chunk, encoding) {
  var ch = this.ch, reply = this.replyQ;

  var queue = this.queues.shift();
  if (queue) {
    this.queues.push(queue);
    var corrId = guid();
    this.awaiting.push({correlationId: corrId, answer: null});
    var options = {replyTo: reply, deliveryMode: true,
                   correlationId: corrId,
                   expiration: this.options.expiration,
                   persistent: this.options.persistent};
    return ch.sendToQueue(queue, bufferify(chunk, encoding), options);
  }
  else return true;
};

ReqSocket.prototype._read = ignore;


function RepSocket(channel, opts) {
  Duplex.call(this, {objectMode: true});
  Socket.call(this, channel, opts);
  this.requests = [];
  this.consumers = {};
}
inherits(RepSocket, Duplex);
addSocketMethods(RepSocket);
RepSocket.prototype.end = end;

RepSocket.prototype.connect = function(source, callback) {
  var self = this, ch = this.ch;

  if (this.consumers[source]) {
    delay(callback); return;
  }

  ch.assertQueue(source, {durable: this.options.persistent})
    .then(function(ok) {
      return ch.consume(source, function(msg) {
        if (msg !== null) {
          self.requests.push(msg);
          self.push(msg.content);
        }
        else self.push(null);
      }, {noAck:false}).then(function(ok) {
        self.consumers[source] = ok.consumerTag;
      });
    }).then(callback || ignore);
};

RepSocket.prototype.write = function(chunk, encoding) {
  var ch = this.ch, current = this.requests.shift();

  if (!current)
    throw new Error('Write with no pending request');
  
  var replyTo = current.properties.replyTo;
  var cid = current.properties.correlationId;
  // Replies are never persistent, because the queue disappears with
  // its socket.
  var options = {
    deliveryMode: true,
    expiration: this.options.expiration,
    correlationId: cid
  };
  var res = ch.sendToQueue(replyTo, bufferify(chunk, encoding),
                           options);
  ch.ack(current);
  return res;
};

RepSocket.prototype._read = ignore;
