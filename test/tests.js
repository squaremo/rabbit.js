var assert = require('assert');

var PARAMS = process.env['AMQP_PARAMS'];
if (PARAMS) {
    try {
        PARAMS = JSON.parse(PARAMS);
    }
    catch (_) {} // assume it's a string and leave as-is
}
else {
    PARAMS = 'amqp://localhost';
}

console.info("Using connection parameters:");
console.info(JSON.stringify(PARAMS));


function withContext(fn) {
    var ctx = require('../index').createContext(PARAMS);
    return fn(ctx);
}

var CTX;
function testWithContext(test) {
    return function(done) { // mocha looks at the number of arguments
        withContext(function(ctx) {
            CTX = ctx;
            CTX.on('ready', function() { return test(done); });
        });
    };
}

var suite = module.exports;

suite.trivialOpenContext = testWithContext(function(done) {
    done();
});

suite.simplestPushPull = testWithContext(function(done) {
    var push = CTX.socket('PUSH');
    var pull = CTX.socket('PULL');
    pull.setEncoding('utf8');
    pull.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    push.connect('testPushPull', function() {
        pull.connect('testPushPull', function() {
            push.write('foo');
        });
    });
});

suite.simplestPubSub = testWithContext(function(done) {
    var pub = CTX.socket('PUB');
    var sub = CTX.socket('SUB');
    sub.setEncoding('utf8');
    sub.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    pub.connect('testPubSub', function() {
        sub.connect('testPubSub', function() {
            pub.write('foo');
        });
    });
});
