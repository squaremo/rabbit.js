var amqp = require('amqp');
var sys = require('sys');
var EventEmitter = require('events').EventEmitter;

var debug = (process.env['DEBUG']) ?
    function(msg) { sys.debug(msg) } : function() {};

function pubSocket(connection, client, exchangeName) {
    sys.log('pub socket opened');
    var exchange = (exchangeName == '') ?
        connection.exchange('amq.fanout', {'passive': true}) :
        connection.exchange(exchangeName,
                            {'type': 'fanout'});
    client.on('message', function(msg) {
        debug('pub:'); debug(msg);
        exchange.publish('', msg);
    });
}

function subSocket(connection, client, exchangeName) {
    sys.log('sub socket opened');
    var exchange = (exchangeName == '') ?
        connection.exchange('amq.fanout', {'passive': 'true'}) :
        connection.exchange(exchangeName,
                            {'type': 'fanout'});
    var queue = connection.queue('');
    queue.subscribe(function(message) {
        debug('sub:'); debug(message);
        client.send(message.data.toString());
    });
    queue.bind(exchange.name, '');
}

function pushSocket(connection, client, queueName) {
    sys.log('push socket opened');
    if (queueName == '') {
        client.send("Must send address for push");
        client.end();
        return;
    }
    var queue = connection.queue(queueName, {'autoDelete': false,
                                             'durable': true,
                                             'exclusive': false});
    var exchange = connection.exchange('');
    client.on('message', function(msg) {
        debug('push:'); debug(msg);
        exchange.publish(queueName, msg);
    });
}

function pullSocket(connection, client, queueName) {
    sys.debug('pull socket opened');
    if (queueName == '') {
        client.send("Must send address for pull");
        client.end();
        return;
    }
    var queue = connection.queue(queueName, {'autoDelete': false,
                                             'durable': true,
                                             'exclusive': false});
    queue.subscribe(function(message) {
        debug('pull:'); debug(message);
        client.send(message.data.toString());
    });
}

function reqSocket(connection, client, queueName) {
    sys.log("req socket opened");
    if (queueName == '') {
        client.send("Must send address for req");
        client.end();
        return;
    }
    var replyQueue = connection.queue('', {'exclusive': true,
                                           'autoDelete': true,
                                           'durable': false});
    var requestQueue = connection.queue(queueName, {'durable': true,
                                                    'autoDelete': false});
    replyQueue.subscribe(function(message) {
        debug('reply:'); debug(message);
        client.send(message.data.toString());
    });
    client.on('message', function(message) {
        debug('request:'); debug(message);
        connection.publish(queueName, message,
                           {'replyTo': replyQueue.name});
    });
}

function repSocket(connection, client, queueName) {
    sys.log("rep socket opened");
    if (queueName == '') {
        client.send("Must send address for req");
        client.end();
        return;
    }
    var queue = connection.queue(queueName, {'durable': true,
                                             'autoDelete': false});
    var replyTo = '';
    client.on('message', function (message) {
        debug('reply:'); debug(message);
        connection.publish(replyTo, message);
    });
    queue.subscribe(function(message) {
        replyTo = message._properties.replyTo;
        debug('request:'); debug(message);
        client.send(message.data.toString());
    });
    client.on('close', function() {
        queue.destroy();
        queue.close();
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

function listen(server, allowed /* , callback */) {
    var connection = amqp.createConnection({'host': '127.0.0.1', 'port': 5672});
    var callback = (arguments.length > 2) ? arguments[2] : null;
    connection.on('ready', function () {
        server.on('connection', function (client) {
            function dispatch(msg) {
                client.removeListener('message', dispatch);
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
                        sys.log("Unknown socket type in: " + msg);
                    }
                }
                else {
                    client.send("Unauthorised rendezvous");
                    client.end();
                    sys.log("Access denied: " + type + " to " + addr);
                }
            }
            client.on('message', dispatch);
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
