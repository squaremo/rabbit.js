// This example makes a web site providing an uppercasing service over
// SockJS. The web page sends the user's input over a SockJS socket,
// which is relayed to a REQuest socket which we're listening on with
// a REPly socket. The answer is then calculated and sent back to the
// browser.
//
// You may ask "Why not just reply directly instead of going through
// RabbitMQ?". Well, imagine that the uppercasing was in fact some
// specialised job that was running in another program, and further
// that we might wish to run several instances of that program to keep
// up with the requests. By using RabbitMQ, the requests will be
// load-balanced among all programs listening on a REPly socket.

var http = require('http');
var url = require('url');
var fs = require('fs');
var sockjs = require('sockjs');
var context = require('../../index').createContext('amqp://localhost:5672');

var port = process.argv[2] || 8080;

// Create a web server on which we'll serve our demo page, and listen
// for SockJS connections.
var httpserver = http.createServer(handler);// Listen for SockJS connections
var sockjs_opts = {
  sockjs_url: "http://cdn.sockjs.org/sockjs-0.2.min.js"};
var sjs = sockjs.createServer(sockjs_opts);
sjs.installHandlers(httpserver, {prefix: '[/]socks'});

context.on('ready', function() {

  var rep = context.socket('REP');
  rep.setEncoding('utf8');
  // Respond to incoming requests
  rep.on('data', function(msg) {
    rep.write(msg.toUpperCase(), 'utf8');
  });
  rep.connect('uppercase');

  // Hook requesting sockets up
  sjs.on('connection', function(connection) {
    var req = context.socket('REQ');
    // Piping into a SockJS socket means that our REQ socket is closed
    // when the SockJS socket is, so there's no clean-up needed.
    req.connect('uppercase', function() {
      // ferry requests and responses back and forth
      req.pipe(connection);
      connection.pipe(req);
    });
  });

  // And finally, start the web server.
  httpserver.listen(port, '0.0.0.0');
});

// ==== boring details

function handler(req, res) {
  var path = url.parse(req.url).pathname;
  switch (path){
  case '/':
  case '/index.html':
    fs.readFile(__dirname + '/index.html', function(err, data) {
      if (err) return send404(res);
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(data, 'utf8');
      res.end();
    });
    break;
  default: send404(res);
  }
}

function send404(res) {
  res.writeHead(404);
  res.write('404');
  return res.end();
}
