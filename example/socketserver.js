require.paths.unshift('.');

var net = require('net');

var s = new net.Server();
var ms = require('messages').listen(s);
require('sockets').listen(ms, null, function() {
    s.listen(9000);
    console.log("listening on 0.0.0.0:9000");
});
