var http = require('http');
var url = require('url');
var fs = require('fs');
var io = require('socket.io');
var socks = require('sockets');

var server = http.createServer(function (req, res) {
	var path = url.parse(req.url).pathname;
	switch (path){
	case '/':
            path = '/index.html';
	case '/index.html':
        case '/pubsub.html':
        case '/request.html':
        case '/reply.html':
	    fs.readFile(__dirname + path, function(err, data){
		if (err) return send404(res);
		res.writeHead(200, {'Content-Type': 'text/html'});
		res.end(data);
	    });
	    break;
	default: send404(res);
	}
});

send404 = function(res){
	res.writeHead(404);
	res.end('404');
};

var socketserver = io.listen(server);
socks.listen(socketserver,
             {allowed:{
                 'requests': ['rep', 'req'],
                 'chat': ['pub', 'sub']}});

server.listen(8080, '0.0.0.0');
