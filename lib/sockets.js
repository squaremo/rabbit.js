var amqp = require('amqp');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream').Stream;
var extend = require('xtend');

var debug = (process.env['DEBUG']) ?
    function(msg) { util.debug(msg) } : function() {};

var info = util.log;

debug('on');

function Context(opts) {
  EventEmitter.constructor.call(this);
  var that = this;
  var c = this._connection = amqp.createConnection(opts);
  c.on('ready', function() { that.emit('ready') });
  c.on('error', function(e) { that.emit('error', e) });
};

var SOCKETS = {
  PUB: PubSocket,
  SUB: SubSocket,
  PUSH: PushSocket,
  PULL: PullSocket,
  REQ: ReqSocket,
  REP: RepSocket
};

(function(proto) {
  Context.prototype = proto;

  proto.socket = function(type, qOpts, opts) {
    var Ctr = SOCKETS[type];
    if (Ctr) {
      return new Ctr(this._connection, qOpts, opts);
    }
    else throw('Undefined socket type ' + type);
  };

})(new EventEmitter());

module.exports.Context = Context;

module.exports.Settings = {
QueueOptions : function QueueOptions(options) {
    if (!(this instanceof QueueOptions)) return new QueueOptions(options);

    this.passive = false;
    // If set, the server will not create the queue.
    // The client can use this to check whether a queue exists without modifying the server state.
    this.durable = false;
    // Durable queues remain active when a server restarts.
    // Non-durable queues (transient queues) are purged if/when a server restarts.
    // Note that durable queues do not necessarily hold persistent messages, although it does not make
    // sense to send persistent messages to a transient queue.
    this.exclusive = false;
    // Exclusive queues may only be consumed from by the current connection.
    // Setting the 'exclusive' flag always implies 'autoDelete'.
    this.autoDelete = true;
    // If set, the queue is deleted when all consumers have finished using it.
    // Last consumer can be cancelled either explicitly or because its channel is closed.
    // If there was no consumer ever on the queue, it won't be deleted.
    this.noDeclare = false;
    // If set, the queue will not be declared,
    // this will allow a queue to be deleted if you dont know its previous options.
    this.arguments = {};
    // a map of additional arguments to pass in when creating a queue.
    this.closeChannelOnUnsubscribe = false;
    // When true the channel will close on unsubscrube, default false.

    if (options) extend(this, options);
},

ExchangeOptions : function ExchangeOptions(options) {
    if (!(this instanceof ExchangeOptions)) return new ExchangeOptions(options);

    this.type = 'topic';
    // the type of exchange 'direct', 'fanout', or 'topic'.
    this.passive = false;
    // If set, the server will not create the exchange. The client can use this to check whether
    // an exchange exists without modifying the server state.
    this.durable = false;
    // If set when creating a new exchange, the exchange will be marked as durable.
    // Durable exchanges remain active when a server restarts.
    // Non-durable exchanges (transient exchanges) are purged if/when a server restarts.
    this.autoDelete = true;
    // If set, the exchange is deleted when there are no longer queues bound to it.
    this.noDeclare = false;
    // If set, the exchange will not be declared, this will allow the exchange
    // to be deleted if you dont know its previous options.
    this.confirm = false;
    // If set, the exchange will be in confirm mode, and you will get a 'ack'|'error' event emitted on a publish,
    // or the callback on the publish will be called.

    if (options) extend(this, options);
},

MessageOptions : function MessageOptions(options) {
    if (!(this instanceof MessageOptions)) return new MessageOptions(options);

    this.mandatory = false;
    // Tells the server how to react if the message cannot be routed to a queue.
    // If this flag is set, the server will return an unroutable message with a Return method.
    // If this flag is false, the server silently drops the message.
    this.immediate = false;
    // Tells the server how to react if the message cannot be routed to a queue consumer immediately.
    // If this flag is set, the server will return an undeliverable message with a Return method.
    // If this flag is false, the server will queue the message, but with no guarantee that it will ever be consumed.
    this.contentType = 'application/octet-stream';
    this.contentEncoding = 'utf8';
    this.headers = {};
    // Arbitrary application-specific message headers.
    this.deliveryMode = 1;
    // Non-persistent (1) or persistent (2)
    this.priority = 1;
    // The message priority, 1 to 9.

    // NOTE: Following values can be set via 'options'.
    //       They MUST contain valid strings and CANNOT be empty or null.
    //this.replyTo = 'queue name';
    //this.expiration = '5000'; //in ms. If '0' message will be dropped immediately.
    //this.timestamp = 0; //64-bit POSIX time_t format
    //this.correlationId = 'id';
    //this.messageId = 'id';
    //this.userId = 'id';
    //this.appId = 'id';

    if (options) extend(this, options);
},

DeleteOptions : function DeleteOptions(options) {
    if (!(this instanceof DeleteOptions)) return new DeleteOptions(options);

    this.ifUnused = false;
    // If set, deletes the queue only if there are no other consumers.
    this.ifEmpty = false;
    // If set, deletes the queue if there are no more messages in it.

    if (options) extend(this, options);
}
};

module.exports.Exchange = function Exchange(name, options) {
    if (!(this instanceof Exchange)) return new Exchange(name, options);

    this.name = name || DEFAULT_EXCHANGE;
    this.options = options || new Settings.ExchangeOptions();
};

module.exports.Queue = function Queue(name, options) {
    if (!(this instanceof Queue)) return new Queue(name, options);

    if (!name) throw "Queue name not specified.";
    this.name = name;
    this.options = options || new Settings.QueueOptions();
};

var DEFAULT_EXCHANGE = '';
var DEFAULT_QUEUE = '';
var DEFAULT_ROUTING_KEY = '';
var DEFAULT_OPTIONS = {};
var DEFAULT_QUEUE_OPTIONS = new module.exports.Settings.QueueOptions();
var DEFAULT_EXCHANGE_OPTIONS = new module.exports.Settings.ExchangeOptions();
var DEFAULT_MESSAGE_OPTIONS = new module.exports.Settings.MessageOptions();
var DEFAULT_DELETE_OPTIONS = new module.exports.Settings.DeleteOptions();

function Socket(connection, opts) {
  this._pause = false;
  this._buffer = [];
  this._acceptOpt = DEFAULT_OPTIONS;
  this._opts = opts || DEFAULT_OPTIONS;
  this.readable = this.writable = false;
  //subtypes expected to set these in connect (or a callback therein)

  this._advertisements = []; // used mainly as a queue, is why
  this._subscriptions = {}; // used as a set

  var that = this;

  // Make available as a prototype. Not sure if there's a better way
  // to accomplish this dual role.
  if (connection) {
    this._connection = connection;
    function handle_error(exception) {
      that.readable = that.writable = false;
      that.emit('error', exception);
      // other shutdown?
    }
    this._connection.on('error', handle_error);
  }
}

(function(proto) {
  Socket.prototype = proto;

  var NOT_YET_WRITABLE =
    "Not writable (yet? Maybe you need to use the callback on connect)";
  var ABSTRACT = "Abstract, supposed to have been supplied by subtype";
  var NOT_WRITABLE = "Read-only stream";
  var UNRECOGNISED_OPTION = "Unknown sockopt";

  // Connect to an address; what this means depends on the kind of
  // socket.
  proto.connect = function(_addr, _callback) {
    throw ABSTRACT;
  }

  // A default implementation that won't accept anything. Override
  // acceptOpts for easy values, or this method for hard (e.g.,
  // multivalue) options.
  proto.setsockopt = function(option, value) {
    if (this._acceptOpt[option]) {
      this._opts[option] = value;
    }
    else {
      throw UNRECOGNISED_OPTION;
    }
  }

  /* Public Stream API */

  proto.destroy = function(deleteQueue, deleteOptions) {
    this.writable = false;
    this.readable = false;
    // Let any unconsumed message be requeued (NB if it's an
    // autoDelete queue, that won't matter)
    // However there still may be messages to deliver; let the
    // callback in _cancel emit 'end'.
    this.end();
    this._cancel(deleteQueue, deleteOptions);
  }

  proto.destroySoon = function() {
    this.destroy();
  }

  proto.pause = function() {
    this._pause = true;
    // TODO stop acknowledging messages; a fixed prefetch should stop
    // them being sent. NB for this to work, we need a prefetch per
    // consumer, i.e., a channel per consumer. Other option: send
    // `channel.flow` (and implement it in the client).
  }

  proto.resume = function() {
    // TODO acknowledge messages again, or send channel.flow again.
    this._pause = false;
    this._flush();
  }

  proto.setEncoding = function(encoding) {
    this._encoding = encoding;
  }

  proto.write = function(data, routeKey, messageOptions, encoding /*, 'utf8' */) {
    // NB flow control as complement to above (may need to expose the
    // underlying TCP flow control via the AMQP client)
    if (routeKey) {
        this.setsockopt('topic', routeKey);
    }
    if (encoding) {
      return this._send(new Buffer(data, encoding), messageOptions);
    }
    return this._send(data, messageOptions);
  }

  proto.end = function() {
    if (arguments.length > 0) {
      proto.write.apply(this, arguments);
    }
    this.writable = false;
    this._advertisements = [];
  }

  /* =============== end public API */

  proto._recv = function(data, msg) {
    if (this._pause) {
      this._buffer.push(data);
    }
    else {
      this._emitData(data, msg);
    }
  }

  proto._flush = function() {
    var buf = this._buffer;
    var d;
    while (!this._pause && (d = buf.shift())) {
      this._emitData(d);
    }
  }

  proto._emitData = function(data, msg) {
    data = (this._encoding) ? data.toString(this._encoding) : data;
    this.emit('data', data, msg);
  }

  proto._addToAdvertisements = function(ex, key) {
        var ads = this._advertisements, len = ads.length;
        for (var i = 0; i < len; i++) {
            var ad = ads[i];
            if (ad.exchange.name === ex.name &&
                ad.routingKey === key) {
                return;
            }
        }
        ads.push({'exchange': ex, 'routingKey': key});
  }

    proto._advertiseQueue = function(queue, callback) {
        var that = this;
        var queueName = ((queue) && (queue.name)) ? queue.name : DEFAULT_QUEUE;
        var queueOptions = ((queue) && (queue.options)) ? queue.options : DEFAULT_QUEUE_OPTIONS;
        this._connection.queue(queueName, queueOptions, function (q) {
            that._addToAdvertisements(that._connection.exchange());
            if (callback) callback();
        });
    };

  proto._advertiseExchange = function(exchange, callback) {
    var that = this;
    var exchangeName = ((exchange) && (exchange.name)) ? exchange.name : DEFAULT_EXCHANGE;
    var exchangeOptions = ((exchange) && (exchange.options)) ? exchange.options : DEFAULT_EXCHANGE_OPTIONS;
    this._connection.exchange(exchangeName, exchangeOptions, function(ex) {
      // We want this to behave a bit like a set too.
      that._addToAdvertisements(ex);
      if (callback) callback();
    });
  }

  proto._send = function(_buf) {
    if (this.writable) {
      throw ABSTRACT;
    }
    // As a convenience, so read-only sockets can just not reassign _send
    else {
      throw NOT_WRITABLE;
    }
  }

  proto._sendOne = function(buf, messageOptions) {
    if (this.writable) {
      var ad = this._advertisements.shift();
      if (ad) {
        // we treat the private queue as our reply queue; so if there
        // is one, use it in reply-to.
        if (!messageOptions) messageOptions = DEFAULT_MESSAGE_OPTIONS;
        if ((this._privateQueue) && 
			(this._privateQueue.name) && 
			(!messageOptions.replyTo)) {
            //set with private queue name
            messageOptions.replyTo = this._privateQueue.name;
        }
        ad.exchange.publish(ad.routingKey, buf, messageOptions);
        this._advertisements.push(ad);
      }
      return true;
    }
    else {
      throw NOT_YET_WRITABLE;
    }
  }

  proto._consumeShared = function(queue, callback) {
    var that = this;
    var queueName = ((queue) && (queue.name)) ? queue.name : DEFAULT_QUEUE;
    var queueOptions = ((queue) && (queue.options)) ? queue.options : DEFAULT_QUEUE_OPTIONS;
    return that._connection.queue(queueName, queueOptions, function(q) {
        that._subscribe(q, callback);
    });
  };

  proto._consumePrivate = function(exchange, routingKey, queue, callback) {
    var that = this;
    var exchangeName = ((exchange) && (exchange.name)) ? exchange.name : DEFAULT_EXCHANGE;
    var exchangeOptions = ((exchange) && (exchange.options)) ? exchange.options : DEFAULT_EXCHANGE_OPTIONS;
    var queueName = ((queue) && (queue.name)) ? queue.name : DEFAULT_QUEUE;
    var queueOptions = ((queue) && (queue.options)) ? queue.options : DEFAULT_QUEUE_OPTIONS;
    if (!routingKey) routingKey = DEFAULT_ROUTING_KEY;

    console.log("Connecting to " + exchangeName + " with " + exchangeOptions.type +
                " type for the binding key " + routingKey + " on queue " + queueName);

    // NB bind is done async.
    function declareExchangeAndBind(q) {
        if (exchange) {
            that._connection.exchange(exchangeName, exchangeOptions,
                function (ex) {
                    q.bind(ex, routingKey);
                    if (callback) callback();
                });
        }
        else {
            if (callback) callback();
        }
    }

    if (this._privateQueue) {
        declareExchangeAndBind(this._privateQueue);
    }
    else {
       this._connection.queue(queueName, queueOptions, function(q) {
          that._privateQueue = q;
          that._subscribe(q, function() {
              declareExchangeAndBind(q);
          });
       });
    }
  };

  proto._subscribe = function(q, callback) {
    var that = this;
    
    q.subscribeRaw({noAck: true}, function(msg) {
      var data = new Buffer(msg.size);
      data.used = 0;
      msg.on('data', function(d) {
        d.copy(data, data.used);
        data.used += d.length;
      });
      msg.on('end', function() {
        // special case for rep socket
        if (that._replies) {
          that._replies.push(msg.replyTo);
        }
        that._recv(data, msg);
        data = null;
      });
    }).addCallback(function(ok) {
      that._subscriptions[q.name] =
        {'queue': q, 'consumerTag': ok.consumerTag};
      if (callback) callback(ok);
    });
  };

  proto._cancel = function(deleteQueue, deleteOptions, callback) {
    var that = this;

    if ((deleteQueue) && (!deleteOptions)) deleteOptions = DEFAULT_DELETE_OPTIONS;
    this.readable = false;
    var latch = 0;

    function finish() {
      // order of these?
      if (callback) callback();
      that.emit('end');
    }

    for (var name in this._subscriptions) {
          var sub = this._subscriptions[name];
          delete this._subscriptions[name];
          latch++;
          if (deleteQueue) {
              sub.queue.destroy(deleteOptions).addCallback(function() {
                  latch--;
                  if (latch === 0) {
                    finish();
                  }
              });
          } else {
                sub.queue.unsubscribe(sub.consumerTag).addCallback(function() {
                    latch--;
                    if (latch === 0) {
                        finish();
                    }
                });
          }
    }
    // if there are no subscriptions
    if (latch === 0) {
      finish();
    }
  };

})(new Stream());

function PubSocket(connection, qOpts, opts) {
  Socket.call(this, connection, qOpts);
  this._acceptOpt = {'topic': true};
  this._opts = opts || {'topic': ''};
}
PubSocket.prototype = new Socket();

PubSocket.prototype.connect = function(exchange, callback) {
  var that = this;
  this._advertiseExchange(exchange, function() {
      that.writable = true;
      if (callback) callback();
  });
};
PubSocket.prototype._send = function(buf, messageOptions) {
  // TODO account flow control, or lack of confirms, or do something
  // else.
  var rk = this._opts.topic;
  if (!messageOptions) messageOptions = DEFAULT_MESSAGE_OPTIONS;

  this._advertisements.forEach(function(ad) {
    ad.exchange.publish(rk, buf, messageOptions);
  });
  return true;
};

function SubSocket(connection, qOpts) {
  Socket.call(this, connection, qOpts);
}
SubSocket.prototype = new Socket();
SubSocket.prototype.connect = function(exchange, routingKey, queue, callback) {
  var that = this;
  this._consumePrivate(exchange, routingKey, queue, function() {
    that.readable = true;
    if (callback) callback();
  });
};

// PUSH socket: it is difficult to give (design, or implement)
// reasonable semantics for connecting to multiple adddresses. Here we
// simply round-robin amongst the given addresses, and trust to the
// queue dispatch to distribute messages; kind of a two-step
// round-robin.

function PushSocket(connection, qOpts) {
  Socket.call(this, connection, qOpts);
}
PushSocket.prototype = new Socket();
PushSocket.prototype.connect = function(queue, callback) {
  var that = this;
  this._advertiseQueue(queue, function() {
    that.writable = true;
    if (callback) callback();
  });
};
PushSocket.prototype._send = PushSocket.prototype._sendOne;

function PullSocket(connection) {
  Socket.call(this, connection);
}
PullSocket.prototype = new Socket();
PullSocket.prototype.connect = function(addr, callback) {
  var that = this;
  this._consumeShared(addr, function() {
    that.readable = true;
    if (callback) callback();
  });
}

function ReqSocket(connection, qOpts) {
  Socket.call(this, connection, qOpts);
}
ReqSocket.prototype = new Socket();
ReqSocket.prototype.connect = function(queue, callback) {
  var that = this;
  this._consumePrivate(null, null, null, function() {
    that.readable = true;
    that._advertiseQueue(queue, function() {
      that.writable = true;
      if (callback) callback();
    });
  });
}
ReqSocket.prototype._send = ReqSocket.prototype._sendOne;

function RepSocket(connection, qOpts) {
  Socket.call(this, connection, qOpts);
  this._replies = [];
}
RepSocket.prototype = new Socket();
RepSocket.prototype.connect = function(queue, callback) {
  var that = this;
  // special case: we send back through the default exchange, so just
  // cache that.
  this._exchange = this._connection.exchange();
  this._consumeShared(queue, function() {
    that.readable = true;
    if (callback) callback();
  });
}
RepSocket.prototype._send = function(data, messageOptions) {
  // WARNING this requires good behaviour on the part of
  // clients. Specifically: each request must have exactly one reply,
  // and they must be made in order they are sent down the wire. The
  // alternative is to be more like dealer/router, which requires
  // multi-part messages or some prefixing scheme.
  var replyQueue = this._replies.shift();
  if (!messageOptions) messageOptions = DEFAULT_MESSAGE_OPTIONS;
  this._exchange.publish(replyQueue, data, messageOptions);
}
