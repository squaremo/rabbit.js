// A message stream decorator.  This simply partitions a stream using
// 4-byte length-prefixes.

var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var debug = (process.env['DEBUG_WIRE']) ?
    function(msg) { util.debug(msg) } : function() {};

var LEN_SIZE = 4;
function read_length(buffer) {
    return (buffer[0] << 24) +
           (buffer[1] << 16) +
           (buffer[2] <<  8) +
           buffer[3];
}

// debug
//exports.read_length = read_length;

function MessageStream(stream) {
    EventEmitter.call(this);
    this._buffers = [];
    this._buflen = 0;
    this._waitlen = 0;
    this._stream = stream;

    var self = this;

    stream.on('connect', function (client) {
        self.emit('connect', client);
    });
    stream.on('disconnect', function (client) {
        self.emit('disconnect', client);
    });

    function collapse_buffers(buf) {
        if (self._buffers.length == 0) {
            return buf;
        }
        var newbuf = new Buffer(self._buflen + buf.length);
        var offset = 0;
        for (i in self._buffers) {
            var b = self._buffers[i];
            b.copy(newbuf, offset, 0);
            offset += b.length;
        }
        buf.copy(newbuf, offset, 0);
        self._buffers = [];
        self._buflen = 0;
        return newbuf;
    }

    function push_buffer(buf) {
        self._buffers.push(buf);
        self._buflen += buf.length;
    }

    var ZERO_MSG = new Buffer(0);

    function read_message(buffer)  {
        // either we are waiting for a new message
        // or we have a length and we're waiting for that much data
        // or we haven't got enough for a length even

        // no length yet
        if (self._waitlen == 0) {
            if (self._buflen + buffer.length >= LEN_SIZE) {
                var buf = collapse_buffers(buffer);
                self._waitlen = read_length(buf);
                // special case for length 0; otherwise we'll look like
                // we're waiting for a length again
                if (self._waitlen == 0) {
                    self.emit('message', ZERO_MSG);
                }
                read_message(buf.slice(LEN_SIZE, buf.length));
            }
            else {
                push_buffer(buffer);
            }
        }
        // we're waiting for data
        else if (self._buflen + buffer.length >= self._waitlen) {
            var buf = collapse_buffers(buffer);
            self.emit('message', buf.slice(0, self._waitlen));
            var used = self._waitlen;
            self._waitlen = 0;
            if (used < buf.length) {
                process.nextTick(function() {
                    read_message(buf.slice(used, buf.length));
                });
            }
        }
        // we're waiting and there still isn't enough
        else {
            push_buffer(buffer);
        }
    }
    stream.on('data', read_message);
};
util.inherits(MessageStream, EventEmitter);

MessageStream.prototype.send = function (message) {
    var len = message.length;
    var buf = new Buffer([       len >> 24,
                          0xff & len >> 16,
                          0xff & len >> 8,
                          0xff & len]);
    this._stream.write(buf);
    this._stream.write(message);
}

MessageStream.prototype.end = function () {
    this._stream.end();
}

exports.MessageStream = MessageStream;

function MessageServer(server) {
    EventEmitter.call(this);
    var self = this;
    self.streams = {};
    server.on('connection', function(stream) {
        var mstream = new MessageStream(stream);
        self.streams[stream] = mstream;
        self.emit('connection', mstream);
    });
    server.on('disconnection', function(stream) {
        var mstream = self.streams[stream];
        delete self.streams[stream];
        self.emit('disconnection', mstream);
    });
}
util.inherits(MessageServer, EventEmitter);

exports.MessageServer = MessageServer;

exports.listen = function(server) {
    return new MessageServer(server);
}
