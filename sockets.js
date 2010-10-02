function pubSocket(client, exchangeName) {
    sys.log('pub socket opened');
    var exchange = (exchangeName == '') ?
        connection.exchange('amq.fanout') :
        connection.exchange(exchangeName,
                            {'passive': true});
    client.on('message', function(msg) {
        sys.log('pub message: ' + msg);
        exchange.publish('', msg);
    });
}

function subSocket(client, exchangeName) {
    sys.log('sub socket opened');
    var exchange = (exchangeName == '') ?
        'amq.fanout' : exchangeName;
    var queue = connection.queue('foo');
    queue.subscribe(function(message) {
        sys.log('sub message: ' + sys.inspect(message));
        client.send(message.data.toString());
    });
    queue.bind(exchange, '');
}

exports.pub = pubSocket;
exports.sub = subSocket;
