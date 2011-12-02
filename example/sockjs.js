var http = require('http');
var url = require('url');
var fs = require('fs');
var sockjs = require('sockjs');
var sockets = require('sockets');

// Create a web server on which we'll serve our demo page, and listen
// for SockJS connections.
var httpserver = http.createServer(function (req, res) {
  var path = url.parse(req.url).pathname;
  switch (path){
  case '/':
  case '/index.html':
    fs.readFile(__dirname + '/sockjs.html', function(err, data) {
      if (err) return send404(res);
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(data, 'utf8');
      res.end();
    });
    break;
  default: send404(res);
  }
});

send404 = function(res) {
	res.writeHead(404);
	res.write('404');
	res.end();
};

// Listen for SockJS connections
var sockjs_opts = {
  sockjs_url: "http://sockjs.github.com/sockjs-client/sockjs-latest.min.js"};
var sjs = sockjs.createServer(sockjs_opts);
sjs.installHandlers(httpserver, {prefix: '[/]socks'});

// Create a connection so we can talk from here too.
var pipes = new sockets.Server();

// Hook it up to rabbit. NB we do the work with a callback, because
// otherwise it will precede the connection being established.
sockets.listen(pipes, {}, function() {
    var conn = pipes.connect();

    // Handler for incoming requests
    conn.on('message', function(msg) {
        conn.send(msg.toUpperCase());
    });
    
    // Make our connection a replier. The connection from our web page
    // will be a requester.
    conn.send('rep questions');
});

// Hook the SockJS server up to rabbit
sockets.listen(sjs,
               {allowed:{'questions': ['req']}});

// And finally, start the web server.
httpserver.listen(8080, '0.0.0.0');
