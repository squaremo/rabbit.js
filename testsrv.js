var msg = require('./messages');
var net = require('net');

var s = new net.Server();
var ms = msg.listen(s);

ms.on('connection', function(msgs) {
    msgs.on('message', console.log);
});

s.listen(9000);
