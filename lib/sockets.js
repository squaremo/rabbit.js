// -*- js-indent: 2 -*-
var amqp = require('amqp');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream').Stream;

var debug = (process.env['DEBUG']) ?
    function(msg) { util.debug(msg) } : function() {};

var info = util.log;

debug('on');

function Context(url) {
  EventEmitter.call(this);
  var that = this;
  var c = this._connection = amqp.createConnection({url: url});
  c.on('ready', function() { that.emit('ready') });
  c.on('error', function(e) { that.emit('error', e) });
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

(function() {
  Context.prototype.socket = function(type) {
    var Ctr = SOCKETS[type];
    if (Ctr) {
      return new Ctr(this._connection);
    }
    else throw('Undefined socket type ' + type);
  }
})();

module.exports.Context = Context;

function Socket(connection) {
  Stream.call(this);
  this._pause = false;
  this._buffer = [];
  this._acceptOpt = {};
  this._opts = {};

  this.readable = this.writable = false;
  //subtypes expected to set these in connect (or a callback therein)

  this._advertisements = []; // used mainly as a queue, is why
  this._subscriptions = {}; // used as a set

  var that = this;

  this._connection = connection;
  function handle_error(exception) {
    that.readable = that.writable = false;
    that.emit('error', exception);
    // other shutdown?
  }
  connection.on('error', handle_error);
}
util.inherits(Socket, Stream);

(function() {
  var proto = Socket.prototype;

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

  proto.destroy = function() {
    this.writable = false;
    this.readable = false;
    // Let any unconsumed message be requeued (NB if it's an
    // autoDelete queue, that won't matter)
    // However there still may be messages to deliver; let the
    // callback in _cancel emit 'end'.
    this.end();
    this._cancel();
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

  proto.write = function(data /*, encoding */) {
    // NB flow control as complement to above (may need to expose the
    // underlying TCP flow control via the AMQP client)
    if (arguments.length > 1) {
      return this._send(new Buffer(data, arguments[1]));
    }
    return this._send(data);
  }

  proto.end = function() {
    if (arguments.length > 0) {
      proto.write.apply(this, arguments);
    }
    this.writable = false;
    this._advertisements = [];
  }

  /* =============== end public API */

  proto._recv = function(data) {
    if (this._pause) {
      this._buffer.push(data);
    }
    else {
      this._emitData(data);
    }
  }

  proto._flush = function() {
    var buf = this._buffer;
    var d;
    while (!this._pause && (d = buf.shift())) {
      this._emitData(d);
    }
  }

  proto._emitData = function(data) {
    data = (this._encoding) ? data.toString(this._encoding) : data;
    this.emit('data', data);
  }

  // Serves a dual-role: if exchange is empty, treat it as a
  // queue-publish.
  proto._advertise = function(exchange, routingKey, callback) {
    var that = this;

    function addToAdvertisements(ex) {
      var ads = that._advertisements, len = ads.length;
      for (var i = 0; i < len; i++) {
        var ad = ads[i];
        if (ad.exchange.name == ex.name &&
            ad.routingKey == routingKey) {
          return;
        }
      }
      ads.push({'exchange': ex, 'routingKey': routingKey});
    }

    if (!exchange) {
      this._connection.queue(
        routingKey,
        {durable: true, autoDelete: false},
        function (q) {
          addToAdvertisements(that._connection.exchange());
          if (callback) callback();
        });
    }
    else {
      var exchangeName, exchangeType;
      exchangeName = exchange.exchange || exchange || 'amq.fanout';
      exchangeType = exchange.routing || 'fanout';
      this._connection.exchange(
        exchangeName,
        {type: exchangeType},
        function(ex) {
          // We want this to behave a bit like a set too.
          addToAdvertisements(ex);
          if (callback) callback();
        });
    }
  };

  proto._send = function(_buf) {
    if (this.writable) {
      throw ABSTRACT;
    }
    // As a convenience, so read-only sockets can just not reassign _send
    else {
      throw NOT_WRITABLE;
    }
  }

  proto._sendOne = function(buf) {
    if (this.writable) {
      var ad = this._advertisements.shift();
      if (ad) {
        // we treat the private queue as our reply queue; so if there
        // is one, use it in reply-to.
        var options = (this._privateQueue) ?
          {'replyTo': this._privateQueue.name} : {};
        ad.exchange.publish(ad.routingKey, buf, options);
        this._advertisements.push(ad);
      }
      return true;
    }
    else {
      throw NOT_YET_WRITABLE;
    }
  }

  proto._consumeShared = function(queueName, callback) {
    var that = this;
    return that._connection.queue(
      queueName, { durable: true, autoDelete: false },
      function(q) {
        that._subscribe(q, callback);
      });
  };

  proto._consumePrivate = function(bindExchange, callback) {
    var that = this;
    var exchangeName, bindingKey, exchangeType;
    exchangeName = bindExchange.exchange || bindExchange || 'amq.fanout';
    bindingKey = bindExchange.pattern || '';
    exchangeType = bindExchange.routing || 'fanout';

    // NB bind is done async.
    function declareExchangeAndBind(q) {
      if (bindExchange) {
        that._connection.exchange(exchangeName, { type: exchangeType },
                                  function (ex) {
                                    q.bind(ex, bindingKey);
                                    callback && callback();
                                  });
      }
      else {
        callback && callback();
      }
    }

    if (this._privateQueue) {
      declareExchangeAndBind(this._privateQueue);
    }
    else {
      this._connection.queue('', function(q) {
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
        that._recv(data);
        data = null;
      });
    }).addCallback(function(ok) {
      that._subscriptions[q.name] =
        {'queue': q, 'consumerTag': ok.consumerTag};
      if (callback) callback(ok);
    });
  };

  proto._cancel = function(callback) {
    var that = this;

    this.readable = false;
    var latch = 0;

    function finish() {
      // order of these?
      if (callback) callback();
      that.emit('end');
    }

    for (name in this._subscriptions) {
      var sub = this._subscriptions[name];
      delete this._subscriptions[name];
      latch++;
      sub.queue.unsubscribe(sub.consumerTag).addCallback(function() {
        latch--;
        if (latch === 0) {
          finish();
        }
      });
    }
    // if there are no subscriptions
    if (latch === 0) {
      finish();
    }
  };

})();

function PubSocket(connection) {
  Socket.call(this, connection);
  this._acceptOpt = {'topic': true};
  this._opts = {'topic': ''};
}
util.inherits(PubSocket, Socket);

PubSocket.prototype.connect = function(exchange, callback) {
  var that = this;
  this._advertise(
    exchange, '', function() {
      that.writable = true;
      if (callback) callback();
    });
};
PubSocket.prototype._send = function(buf) {
  // TODO account flow control, or lack of confirms, or do something
  // else.
  var rk = this._opts.topic;
  this._advertisements.forEach(function(ad) {
    ad.exchange.publish(rk, buf);
  });
  return true;
};

function SubSocket(connection) {
  Socket.call(this, connection);
}
util.inherits(SubSocket, Socket);

SubSocket.prototype.connect = function(exchange, callback) {
  var that = this;
  this._consumePrivate(exchange, function() {
    that.readable = true;
    if (callback) callback();
  });
};

// PUSH socket: it is difficult to give (design, or implement)
// reasonable semantics for connecting to multiple adddresses. Here we
// simply round-robin amongst the given addresses, and trust to the
// queue dispatch to distribute messages; kind of a two-step
// round-robin.

function PushSocket(connection) {
  Socket.call(this, connection);
}
util.inherits(PushSocket, Socket);

PushSocket.prototype.connect = function(queue, callback) {
  var that = this;
  this._advertise('', queue, function() {
    that.writable = true;
    if (callback) callback();
  });
};
PushSocket.prototype._send = PushSocket.prototype._sendOne;

function PullSocket(connection) {
  Socket.call(this, connection);
}
util.inherits(PullSocket, Socket);

PullSocket.prototype.connect = function(addr, callback) {
  var that = this;
  this._consumeShared(addr, function() {
    that.readable = true;
    if (callback) callback();
  });
}

function ReqSocket(connection) {
  Socket.call(this, connection);
}
util.inherits(ReqSocket, Socket);

ReqSocket.prototype.connect = function(queue, callback) {
  var that = this;
  this._consumePrivate(false, function() {
    that.readable = true;
    that._advertise('', queue, function() {
      that.writable = true;
      if (callback) callback();
    });
  });
}
ReqSocket.prototype._send = ReqSocket.prototype._sendOne;

function RepSocket(connection) {
  Socket.call(this, connection);
  this._replies = [];
}
util.inherits(RepSocket, Socket);

RepSocket.prototype.connect = function(queue, callback) {
  var that = this;
  // special case: we send back through the default exchange, so just
  // cache that.
  this._exchange = this._connection.exchange('');
  this._consumeShared(queue, function() {
    that.readable = true;
    if (callback) callback();
  });
}
RepSocket.prototype._send = function(data) {
  // WARNING this requires good behaviour on the part of
  // clients. Specifically: each request must have exactly one reply,
  // and they must be made in order they are sent down the wire. The
  // alternative is to be more like dealer/router, which requires
  // multi-part messages or some prefixing scheme.
  var replyQueue = this._replies.shift();
  this._exchange.publish(replyQueue, data);
}
