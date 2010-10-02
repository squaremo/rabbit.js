var amqp = require('./node-amqp/');
var sys = require('sys');

var connection = amqp.createConnection({'host': '127.0.0.1', 'port': 5672});

function pubSocket(client, exchangeName) {
    sys.debug('pub socket opened');
    var exchange = (exchangeName == '') ?
        connection.exchange('amq.fanout') :
        connection.exchange(exchangeName,
                            {'passive': true});
    client.on('message', function(msg) {
        sys.debug('pub message: ' + msg);
        exchange.publish('', msg);
    });
}

function subSocket(client, exchangeName) {
    sys.debug('sub socket opened');
    var exchange = (exchangeName == '') ?
        'amq.fanout' : exchangeName;
    var queue = connection.queue('');
    queue.subscribe(function(message) {
        sys.debug('sub message: ' + sys.inspect(message));
        client.send(message.data);
    });
    queue.bind(exchange, '');
}

function listen(server) {
    server.on('connection', function (client) {
        function dispatch(msg) {
            client.removeListener('message', dispatch);
            msg = msg.toString();
            var i = msg.indexOf(' ');
            var type = (i > -1) ? msg.substring(0, i) : msg;
            var addr = (i > -1) ? msg.substr(i) : '';
            sys.debug('type: ' + type);
            switch (type) {
            case 'pub':
                pubSocket(client, addr)
                break;;
            case 'sub':
                subSocket(client, msg.substr(4));
                break;
            default:
                client.send("Unknown socket type");
                sys.debug("Unknown socket type: " + msg);
            }
        }
        
        client.on('message', dispatch);
    });
}

exports.listen = listen;