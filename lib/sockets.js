var amqp = require('amqp');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream').Stream;

var debug = (process.env['DEBUG']) ?
    function(msg) { util.debug(msg) } : function() {};

var info = util.log;

debug('on');

function Context(url) {
  EventEmitter.constructor.call(this);
  var that = this;
  that._ready = false;
  var c = that._connection = amqp.createConnection({url: url});
  c.on('ready', function() { that.emit('ready') });
};

(function(proto) {
  Context.prototype = proto;

  proto.socket = function(type) {
    switch (type) {
    case 'PUB': return new PubSocket(this._connection);
    case 'SUB': return new SubSocket(this._connection);
    case 'PUSH': return new PushSocket(this._connection);
    case 'PULL': return new PullSocket(this._connection);
//    case 'REQ': return new ReqSocket(this._connection, addr);
//    case 'REP': return new RepSocket(this._connection, addr);
//    case 'XREQ': return new XreqSocket(this._connection, addr);
//    case 'XREP': return new XrepSocket(this._connection, addr);
    default: throw('Undefined socket type ' + type);
    }
  };

})(new EventEmitter());

module.exports.Context = Context;

function Socket(connection) {
  this._pause = false;

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

  // Connect to an address; what this means depends on the kind of
  // socket.
  proto.connect = function(_addr, _callback) {
    throw ABSTRACT;
  }

  /* Public Stream API */

  proto.destroy = function() {
    this.writable = false;
    this.readable = false;
    // Let any unconsumed message by requeued (NB if it's an
    // autoDelete queue, that won't matter)
    // However there still may be messages to deliver; let the
    // callback in _cancel emit 'end'.
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
    // `channel.flow` (and implement it in the client). There will
    // anyway be a race here, so we'll need to buffer messages until
    // we get a response.
  }

  proto.resume = function() {
    // TODO acknowledge messages again, or send channel.flow again.
    this._pause = false;
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

  /* =============== end public API */

  proto._emitData = function(data) {
    data = (this._encoding) ? data.toString(this._encoding) : data;
    this.emit('data', data);
  }

  // Serves a dual-role: if exchange is empty, treat it as a
  // queue-publish.
  proto._advertise = function(exchangeName, routingKey, callback) {
    var that = this;

    function addToAdvertisements(ex) {
      var ads = that._advertisements;
      for (var i in ads) {
        var ad = ads[i];
        if (ad.exchange.name == ex.name &&
            ad.routingKey == routingKey) {
          return;
        }
      }
      ads.push({'exchange': ex, 'routingKey': routingKey});
    }

    if (exchangeName === '') {
      this._connection.queue(
        routingKey,
        {durable: true, autoDelete: false},
        function (q) {
          addToAdvertisements(that._connection.exchange());
          if (callback) callback();
        });
    }
    else {
      this._connection.exchange(
        exchangeName,
        {type: 'fanout'},
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

  proto._sendAll = function(buf) {
    // TODO account flow control, or lack of confirms, or do something
    // else.
    if (this.writable) {
      this._advertisements.forEach(function(ad) {
        ad.exchange.publish(ad.routingKey, buf);
      });
      return true;
    }
    else {
      throw NOT_YET_WRITABLE;
    }
  };

  proto._sendOne = function(buf) {
    if (this.writable) {
      var ad = this._advertisements.shift();
      if (ad) {
        ad.exchange.publish(ad.routingKey, buf);
        this._advertisements.push(ad);
      }
      return true;
    }
    else {
      throw NOT_YET_WRITABLE;
    }
  }

  // dual-purpose: if queueName is falsey, bind an exclusive queue to
  // bindExchange, creating the queue and consuming from it if
  // necessary; if queueName is a (non-empty) string, make sure the
  // queue exists and consume from it.
  proto._consume = function(queueName, bindExchange, callback) {
    var that = this;

    // node-amqp does not currently accept a callback for queue#bind,
    // so we are forced into doing the bind first then the subscribe,
    // rather than the prefereable subscribe first then bind.

    // TODO we may not want to create a queue every time for anon
    // subscriptions.

    function declareExchangeAndBind(q, exCallback) {
      if (bindExchange != '') {
        that._connection.exchange(bindExchange, { type: 'fanout' },
                                  function (ex) {
                                    q.bind(ex, '');
                                    if (exCallback) exCallback();
                                  });
      }
    }

    function createQueueBindAndConsume() {
      var options =
        (queueName) ?
        { durable: true, autoDelete: false } :
        { exclusive: true, autoDelete: true };
      return that._connection.queue(
        queueName || '', options,
        function(q) {
          declareExchangeAndBind(q); // no callback; do it below
          // relies on serialisation of channel commands
          q.subscribeRaw({noAck: true}, function(msg) {
            var data = new Buffer(msg.size);
            data.used = 0;
            msg.on('data', function(d) {
              d.copy(data, 0, data.used);
              data.used += d.length;
            });
            msg.on('end', function() {
              that._emitData(data);
              data = null;
            });
          }).addCallback(function(ok) {
            that._subscriptions[q.name] =
              {'queue': q, 'consumerTag': ok.consumerTag};
            if (callback) callback(ok);
          });
        });
    }

    if (queueName === '') {
      if (this._privateQueue) {
        // supply the callback here, since it won't be called otherwise
        declareExchangeAndBind(this._privateQueue, callback);
      }
      else {
        this._privateQueue = createQueueBindAndConsume();
      }
    }
    else {
      createQueueBindAndConsume();
    }
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

})(new Stream());

function PubSocket(connection) {
  Socket.call(this, connection);
}
PubSocket.prototype = new Socket();
PubSocket.prototype.connect = function(exchange, callback) {
  var that = this;
  this._advertise(
    exchange, "", function() {
      that.writable = true;
      if (callback) callback();
    });
};
PubSocket.prototype._send = PubSocket.prototype._sendAll;

function SubSocket(connection) {
  Socket.call(this, connection);
}
SubSocket.prototype = new Socket();
SubSocket.prototype.connect = function(exchange, callback) {
  var that = this;
  this._consume('', exchange, function() {
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
PushSocket.prototype = new Socket();
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
PullSocket.prototype = new Socket();
PullSocket.prototype.connect = function(addr, callback) {
  var that = this;
  this._consume(addr, '', function() {
    that.readable = true;
    if (callback) callback();
  });
}

// ======= deprecated ======
// %%% NB: PUB/SUB removed, remove others as implemented.

function pushSocket(connection, client, queueName) {
    info('push socket opened');
    var send = sendfun(client);
    if (queueName == '') {
        send("Must send address for push");
        client.end();
        return;
    }
    connection.queue(
        queueName, {'autoDelete': false,
                    'durable': true,
                    'exclusive': false},
        function(queue) {
            onmsg(client, function(msg) {
                debug('push:'); debug(msg);
                connection.publish(queueName, msg);
            });
        });
}

function pullSocket(connection, client, queueName) {
    info('pull socket opened');
    var send = sendfun(client);
    if (queueName == '') {
        send("Must send address for pull");
        client.end();
        return;
    }
    connection.queue(
        queueName,
        {'autoDelete': false, 'durable': true, 'exclusive': false},
        function(queue) {
            queue.subscribe(function(message) {
                debug('pull:'); debug(message);
                send(message.data.toString());
            });
            client.on('close', function() {
                // oh. no unsubscribe in node-amqp.
            });
        });
}

function reqSocket(connection, client, queueName) {
    info("req socket opened");
    var send = sendfun(client);
    if (queueName == '') {
        send("Must send address for req");
        client.end();
        return;
    }
    connection.queue('',
        {'exclusive': true, 'autoDelete': true, 'durable': false},
        function(replyQueue) {
            replyQueue.subscribe(function(message) {
                debug('reply:'); debug(message);
                send(message.data.toString());
            });
            connection.queue(
                queueName, {'durable': true, 'autoDelete': false},
                function(queue) {
                    onmsg(client, function(message) {
                        debug('request:'); debug(message);
                        connection.publish(queueName, message,
                                           {'replyTo': replyQueue.name});
                    });
                    client.on('close', function() {
                        replyQueue.destroy();
                    });
                });
        });
}

function repSocket(connection, client, queueName) {
    info("rep socket opened");
    var send = sendfun(client);
    if (queueName == '') {
        send("Must send address for req");
        client.end();
        return;
    }
    connection.queue(
        queueName, {'durable': true, 'autoDelete': false},
        function(queue) {
            var replyTo = '';
            onmsg(client, function (message) {
                debug('reply to: ' + replyTo); debug(message);
                connection.publish(replyTo, message);
            });
            queue.subscribe(function(message, _headers, properties) {
                replyTo = properties['replyTo'];
                debug('request:'); debug(message);
                send(message.data.toString());
            });
            client.on('close', function() {
                // Again, no unsubscribe.
            });
        });
}
