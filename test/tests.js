var assert = require('assert');
var createContext = require('../index').createContext;

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

var suite = module.exports;

suite.trivialOpenContext = testWithContext(function(done) {
    done();
});

// Sadly, this is broken in the node-amqp library.

// suite.connectionError = function(done) {
//     var ctx = createContext('amqp://notauser:surely@localhost');
//     ctx.on('error', done);
//     ctx.on('ready', function() {
//         assert.fail("Expected to fail connection open");
//     });
// };

function withContext(fn) {
    var ctx = createContext(PARAMS);
    return fn(ctx);
}

function testWithContext(test) {
    return function(done) { // mocha looks at the number of arguments
        withContext(function(ctx) {
            var closeAndDone = function(maybeErr) {
              ctx.close();
              done(maybeErr);
            };
            ctx.on('ready', function() { return test(closeAndDone, ctx); });
        });
    };
}

suite.closeConnectionWithoutSocket = testWithContext(function(done, CTX) {
  CTX.on('error', done);
  CTX.on('close', done);
  CTX.close();
});

suite.endWithoutConnect = testWithContext(function(done, CTX) {
  var sock = CTX.socket('PUB');
  sock.on('error', done);
  sock.on('close', done);
  sock.end();
});

suite.endWithReadable = testWithContext(function(done, CTX) {
  var sock = CTX.socket('SUB');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testSubEnd', function() {
    sock.end();
  });
});

suite.endWithWriteable = testWithContext(function(done, CTX) {
  var sock = CTX.socket('PUB');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testPubEnd', function() {
    sock.end();
  });
});

suite.endWithDuplex = testWithContext(function(done, CTX) {
  var sock = CTX.socket('REQ');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testReqEnd', function() {
    sock.end();
  });
});

suite.endAwaitsConnects = testWithContext(function(done, CTX) {
  var sock = CTX.socket('REP');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testRepEnd');
  sock.connect('testRepEnd2');
  sock.end();
});

// Test we can happily maintain a rolling set of sockets. The main
// concern is leaking event handlers (which node.js shall warn us
// about).
suite.testManySockets = testWithContext(function(done, CTX) {
  var WINDOW = 10;
  var socks = [];
  var types = ['PUB', 'SUB', 'PUSH', 'PULL', 'REQ', 'REP'];
  var total = WINDOW * 10;
  var ended = 0;
  function latch() {
    ended++;
    if (ended === total) done();
  }
  for (var i = 0; i < total; i++) {
    var t = types.shift(); types.push(t);
    var s = CTX.socket(t);
    s.connect('testManySockets');
    s.on('close', latch);
    socks.push(s);
    if (i > WINDOW) {
      socks.shift().end();
    }
  }
  var s1; while (s1 = socks.shift()) s1.end();
});

suite.simplestPushPull = testWithContext(function(done, CTX) {
    var push = CTX.socket('PUSH');
    var pull = CTX.socket('PULL');
    pull.setEncoding('utf8');
    pull.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    push.connect('testPushPull', function() {
      push.write('foo');
      pull.connect('testPushPull');
    });
});

suite.simplestPubSub = testWithContext(function(done, CTX) {
    var pub = CTX.socket('PUB');
    var sub = CTX.socket('SUB');
    sub.setEncoding('utf8');
    sub.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    sub.connect('testPubSub', function() {
        pub.connect('testPubSub', function() {
            pub.write('foo');
        });
    });
});

suite.simplestReqRep = testWithContext(function(done, CTX) {
    var req = CTX.socket('REQ');
    var rep = CTX.socket('REP');

    rep.setEncoding('utf8');
    rep.on('data', function(msg) {
        assert.equal('question', msg);
        rep.write('answer');
    });

    req.setEncoding('utf8');
    req.on('data', function(msg) {
        assert.equal('answer', msg);
        done();
    });

    req.connect('testReqRep', function() {
        rep.connect('testReqRep', function() {
            req.write('question');
        });
    });
});

suite.allSubs = testWithContext(function(done, CTX) {
    var subs = [CTX.socket('SUB'), CTX.socket('SUB'), CTX.socket('SUB')];
    var latch = subs.length;

    function doSub(i) {
        if (i === subs.length) {
            return cont();
        }
        var sub = subs[i];
        sub.setEncoding('utf8');
        sub.on('data', function(msg) {
            assert.equal('multi', msg);
            latch--;
            if (latch === 0) done();
        });
        sub.connect('testMultiSub', function() { doSub(i+1); });
    }

    function cont() {
        var pub = CTX.socket('PUB');
        pub.connect('testMultiSub', function() {
            pub.write('multi');
        });
    }

    doSub(0);
});

suite.onePull = testWithContext(function(done, CTX) {
    // It's very difficult to test that something didn't happen;
    // however we can serialise sends with recvs to make sure the
    // whole moves in single steps.
    var pulls = [CTX.socket('PULL'), CTX.socket('PULL'), CTX.socket('PULL')];
    var expect = {'start': 'first',
                  'first': 'second',
                  'second': 'third',
                  'third': 'end'};
    var state = 'start';

    function doPull(i) {
        if (i === pulls.length) {
            return cont();
        }
        var pull = pulls[i];
        pull.setEncoding('utf8');
        pull.on('data', function(msg) {
            assert.equal(expect[state], msg);
            // make sure we can't make this transition again
            delete expect[state];
            state = msg;
            if (state === 'end')
                done();
            else
                send();
        });
        pull.connect('testMultiPull', function() { doPull(i+1); });
    }

    var push = CTX.socket('PUSH');

    function send() {
        push.write(expect[state]);
    }

    function cont() {
        push.connect('testMultiPull', function() {
            send();
        });
    }

    doPull(0);
});

suite.expiredPush = testWithContext(function(done, CTX){
  var pull = CTX.socket('PULL');
  pull.setEncoding('utf8');
  
  var push = CTX.socket('PUSH');
  var target = 'testExpiration';

  function doPull() {
    setTimeout(function() {
      pull.connect(target, function() {
        pull.once('data', function (msg) {
          switch (msg) {
          case "Expires":
            return done(new Error("Got expired msg"));
          case "Does not expire":
            return done();
          default:
            return done(new Error("What even is this msg?"));
          }
        });
      });
    }, 40);
  }

  function send() {
    // the expiration can be small; the point is, it gets expired well
    // before we connect with the pull socket
    push.setsockopt('expiration', 10);
    push.write('Expires');
    push.setsockopt('expiration', undefined);
    push.write('Does not expire');
  }

  push.connect(target, send);
  doPull();
});
// NB much harder to test expiration on pub, since it won't rest in a
// queue unless there's a sub socket -- and if there's a sub socket,
// the likelihood is it will get the message before it expires.


// Will fail when attempting to declare the unfortunately-named
// exchange
suite.exchangeError = testWithContext(function(done, CTX) {
  var sock = CTX.socket('SUB');
  sock.on('error', function(e) {
    assert.ok(!sock.readable && !sock.writable);
    done();
  });
  sock.connect('amq.not-supposed-to-exist');
});

// Will fail when attempting to declare the unfortunately-named queue
suite.queueError = testWithContext(function(done, CTX) {
  var sock = CTX.socket('PULL');
  sock.on('error', function(e) {
    assert.ok(!sock.readable && !sock.writable);
    done();
  });
  sock.connect('amq.reserved-namespace');
});

suite.redeclareExchangeError = testWithContext(function(done, CTX) {
  var sock1 = CTX.socket('PUB');
  sock1.on('error', function(e) {
    assert.fail('This socket should succeed');
  });
  var sock2 = CTX.socket('PUB');
  sock2.on('error', function(e) {
    assert.ok(!sock2.writable);
    assert.ok(sock1.writable);
    done();
  });

  sock1.connect({
    exchange: 'test-redeclare-error',
    routing: 'topic'
  }, function() {
    sock2.connect({exchange: 'test-redeclare-error',
                   routing: 'direct'});
    sock1.write('foobar');
  });
});
