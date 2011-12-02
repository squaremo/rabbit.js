var net = require('net'),
    messages = require('messages'),
    sockets = require('sockets');

var server = new sockets.Server();

var inSrv = net.createServer(function(connection) {
    var incoming = server.connect();
    incoming.send('push items');
    connection.on('data', function(data) {
        incoming.send(data);
    });
    connection.on('close', function() {
        incoming.end();
    });
});

var outSrv = net.createServer(function(connection) {
    var outgoing = server.connect();
    outgoing.on('message', function(data) {
        connection.write(data);
    });
    connection.on('close', function() {
        outgoing.end();
    });
    outgoing.send('pull items');
});

sockets.listen(server, {}, function() {
    inSrv.listen(5001, function() {
        console.log("Listening for push connections on 5001");
    });
    outSrv.listen(5002, function() {
        console.log("Listening for pull connections on 5002");
    });
});
