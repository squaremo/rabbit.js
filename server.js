var http = require('http');
var url = require('url');
var fs = require('fs');
var io = require('./Socket.IO-node/lib/socket.io');
var sys = require('sys');
var amqp = require('./node-amqp/');

var server = http.createServer(function (req, res) {
	var path = url.parse(req.url).pathname;
	switch (path){
	case '/':
            path = '/index.html';
	case '/json.js':
	case '/index.html':
	    fs.readFile(__dirname + path, function(err, data){
		if (err) return send404(res);
		res.writeHead(200, {'Content-Type': path == 'json.js' ? 'text/javascript' : 'text/html'})
		res.write(data, 'utf8');
		res.end();
	    });
	    break;
	default: send404(res);
	}
});

send404 = function(res){
	res.writeHead(404);
	res.write('404');
	res.end();
};

var socket = io.listen(server);

var connection = amqp.createConnection({'host': '127.0.0.1', 'port': 5672});
//connection.connect();

socket.on('connection', function (client) {
    function dispatch(msg) {
        sys.log('msg: ' + msg);
        client.removeListener('message', dispatch);
        if (msg.substr(0, 3) == 'pub') {
            sys.log('connecting pub socket');
            pubSocket(client, msg.substr(4));
        }
        else {
            client.send("Unknown socket type");
            sys.log("Unknown socket type: " + msg);
        }
    }
    
    client.on('message', dispatch);
});

function pubSocket(client, exchangeName) {
    sys.log('pub socket opened');
    var exchange = (exchangeName == '') ?
        connection.exchange('amq.fanout') :
        connection.exchange(exchangeName,
                            {'type': 'fanout'});
    client.on('message', function(msg) {
        sys.log('pub message: ' + msg);
        exchange.publish('', msg);
    });
}

server.listen(8080);
