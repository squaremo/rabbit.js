var http = require('http');
var url = require('url');
var fs = require('fs');
var io = require('socket.io');
var context = require('../../index').createContext();

var port = process.argv[2] || 8080;

var httpserver = http.createServer(handler);

var socketioserver = io.listen(httpserver);

socketioserver.sockets.on('connection', function(connection) {
  var pub = context.socket('PUB');
  var sub = context.socket('SUB');

  connection.on('disconnect', function() {
    pub.close();
    sub.close();
  });

  // NB we have to adapt between the APIs
  sub.setEncoding('utf8');
  connection.on('message', function(msg) {
    pub.write(msg, 'utf8');
  });
  sub.on('data', function(msg) {
    connection.send(msg);
  });
  sub.connect('chat');
  pub.connect('chat');
});

httpserver.listen(port, '0.0.0.0');

// ==== boring detail

function handler(req, res) {
  var path = url.parse(req.url).pathname;
  switch (path){
  case '/':
    path = '/index.html';
  case '/index.html':
    fs.readFile(__dirname + '/index.html', function(err, data){
      if (err) return send404(res);
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(data, 'utf8');
      res.end();
    });
    break;
  default: send404(res);
  }
}

function send404(res){
  res.writeHead(404);
  res.write('404');
  res.end();
}

