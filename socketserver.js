var net = require('net');

var s = new net.Server();
var ms = require('./messages').listen(s);
require('./sockets').listen(ms);

s.listen(9000);
