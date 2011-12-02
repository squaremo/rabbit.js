var amqp = require('amqp');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var debug = (process.env['DEBUG']) ?
    function(msg) { util.debug(msg) } : function() {};

var info = util.log;

debug('on');

// SocketIO likes 'message', SockJS likes 'data'.
// Nothing likes both, so far ..
function onmsg(client, handler) {
    client.on('message', handler);
    client.on('data', handler);
}

function sendfun(client) {
    return ('send' in client) ?
        function(msg) { return client.send(msg); } :
        function(msg) { return client.write(msg); } ;
}

function pubSocket(connection, client, exchangeName) {
    info('pub socket opened');
    function publishTo(exchange) {
        onmsg(client, function(msg) {
            exchange.publish('', msg);
        });
    }
    (exchangeName == '') ?
        connection.exchange('amq.fanout', {'passive': true}, publishTo) :
        connection.exchange(exchangeName, {'type': 'fanout'}, publishTo);
}

function subSocket(connection, client, exchangeName) {
    info('sub socket opened');
    var send = sendfun(client);
    function consume(exchange) {
        queue = connection.queue('', {durable:false}, function() {
            queue.subscribe(function(message) {
                debug('sub:'); debug(message);
                send(message.data.toString());
            });
            queue.bind(exchange.name, '');
        });
        client.on('close', function() {
            queue.destroy();
        });
    };
    (exchangeName == '') ?
        connection.exchange('amq.fanout', {'passive': true}, consume) :
        connection.exchange(exchangeName, {'type': 'fanout'}, consume);
}

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

function Pipe() {
    var fore = this.fore = new EventEmitter(); // client --> server
    var aft = this.aft = new EventEmitter();   // server --> client
    aft.send = function (msg) {
        debug('aft send:'); debug(msg);
        fore.emit('message', msg);
    };
    fore.send = function (msg) {
        debug('fore send:'); debug(msg);
        aft.emit('message', msg);
    };
    aft.end = function() {
        aft.emit('close');
    }
    fore.end = function() {
        fore.emit('close');
    }
    fore.on('close', function () {
        debug('fore close');
    });
    aft.on('close', function () {
        debug('aft close');
    });
}

function PipeServer() {
    EventEmitter.call(this);
}

(function(S) {
    var P = S.prototype = new EventEmitter();

    P.connect = function() {
        var p = new Pipe();
        this.emit('connection', p.aft);
        return p.fore;
    }

})(PipeServer);

exports.Server = PipeServer;
exports.Pipe = Pipe;

function listen(server, options /* , callback */) {
    var url = options && options.url || 'amqp://localhost';
    var allowed = options && options.allowed;

    var connection = amqp.createConnection({'url': url});
    var callback = (arguments.length > 2) ? arguments[2] : null;
    connection.on('ready', function () {
        debug('AMQP connection established');
        server.on('connection', function (client) {
            function dispatch(msg) {
                client.removeListener('message', dispatch);
                client.removeListener('data', dispatch);
                msg = msg.toString();
                var i = msg.indexOf(' ');
                var type = (i > -1) ? msg.substring(0, i) : msg;
                var addr = (i > -1) ? msg.substr(i+1) : '';
                if (check_rendezvous(type, addr, allowed)) {
                    switch (type) {
                    case 'pub':
                        pubSocket(connection, client, addr)
                        break;;
                    case 'sub':
                        subSocket(connection, client, addr);
                        break;
                    case 'push':
                        pushSocket(connection, client, addr);
                        break;
                    case 'pull':
                        pullSocket(connection, client, addr);
                        break;
                    case 'req':
                        reqSocket(connection, client, addr);
                        break;
                    case 'rep':
                        repSocket(connection, client, addr);
                        break;
                    default:
                        client.send("Unknown socket type");
                        client.end();
                        info("Unknown socket type in: " + msg);
                    }
                }
                else {
                    client.send("Unauthorised rendezvous");
                    client.end();
                    info("Access denied: " + type + " to " + addr);
                }
            }
            onmsg(client, dispatch);
        });
        if (callback) callback();
    });
}

function check_rendezvous(type, addr, allowed) {
    if (!allowed) return true; // no explicit list = everything goes
    var socks = allowed[addr];
    return socks && socks.indexOf(type) > -1
}

exports.listen = listen;
