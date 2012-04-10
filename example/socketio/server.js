if (typeof process.argv[2] == 'undefined') {
  console.error('Usage: node server <port>');
  return;
}

var http = require('http');
var url = require('url');
var fs = require('fs');
var io = require('socket.io');
var context = require('../../index').createContext();

var httpserver = http.createServer(handler);

var socketioserver = io.listen(httpserver);

socketioserver.sockets.on('connection', function(connection) {
  var pub = context.socket('PUB');
  var sub = context.socket('SUB');

  connection.on('disconnect', function() {
    pub.destroy();
    sub.destroy();
  });

  // NB we have to adapt between the APIs
  sub.setEncoding('utf8');
  connection.on('message', function(msg) {
    pub.write(msg);
  });
  sub.on('data', function(msg) {
    connection.send(msg);
  });
  sub.connect('chat');
  pub.connect('chat');
});

httpserver.listen(process.argv[2], '0.0.0.0');

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
      res.write(data.toString('utf8').replace('{{PORT}}', process.argv[2]), 'utf8');
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

