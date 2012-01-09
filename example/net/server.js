// This example listens for connections on two ports.  On port 5001,
// any connection will be treated as an input, and the (line-buffered)
// packets PUSHed to the queue 'items'; any connection on port 5002
// will be treated as an output, and PULL messages from the queue.

// NB this needs a RabbitMQ server on localhost:5672 (or to be adapted
// as appropriate).

var net = require('net'),
    context = require('../../index').createContext('amqp://localhost:5672');

var inSrv = net.createServer(function(connection) {
  var push = context.socket('PUSH');
  connection.on('close', function() {
    push.destroy();
  });
  push.connect('items', function() {
    connection.pipe(push);
  });
});

var outSrv = net.createServer(function(connection) {
  var pull = context.socket('PULL');
  connection.on('close', function() {
    pull.destroy();
  });
  pull.connect('items', function() {
    pull.pipe(connection);
  });
});

inSrv.listen(5001, function() {
  console.log("Listening for push connections on 5001");
});
outSrv.listen(5002, function() {
  console.log("Listening for pull connections on 5002");
});
