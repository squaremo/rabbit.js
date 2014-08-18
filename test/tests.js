var assert = require('assert');

var createContext = require('../index').createContext;

var delay = global.setImmediate || process.nextTick;

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

function randomString() {
  var seed = Math.random();
  return 'rnd' + seed.toString();
}

var suite = module.exports;

suite.trivialOpenContext = testWithContext(function(done) {
    done();
});

suite.connectionError = function(done) {
    var ctx = createContext('amqp://nosuchhost.example.com');
    ctx.on('error', function () { done() ; });
    ctx.on('ready', function() {
         done(new Error("Expected to fail connection open"));
    });
};

function withContext(fn) {
    var ctx = createContext(PARAMS);
    return fn(ctx);
}

function testWithContext(test) {
    return function(done) { // mocha looks at the number of arguments
        withContext(function(ctx) {
            var closeAndDone = function(maybeErr) {
              delay(ctx.close.bind(ctx));
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
  sock.close();
});

suite.endWithReadable = testWithContext(function(done, CTX) {
  var sock = CTX.socket('SUB');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testSubEnd', function() {
    sock.close();
  });
});

suite.endWithWriteable = testWithContext(function(done, CTX) {
  var sock = CTX.socket('PUB');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testPubEnd', function() {
    sock.close();
  });
});

suite.endWithDuplex = testWithContext(function(done, CTX) {
  var sock = CTX.socket('REQ');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testReqEnd', function() {
    sock.close();
  });
});

suite.endAwaitsConnects = testWithContext(function(done, CTX) {
  var sock = CTX.socket('REP');
  sock.on('error', done);
  sock.on('close', done);
  sock.connect('testRepEnd', function() {
    sock.connect('testRepEnd2', function() {
      sock.close();
    });
  });
});

suite.endWithWrite = testWithContext(function(done, CTX) {
    var msg = randomString();
    var pull = CTX.socket('PULL');
    pull.connect('testEndWithWrite');
    pull.setEncoding('utf8');
    pull.on('data', function(m) {
        if (m === msg) done();
    });
    var push = CTX.socket('PUSH');
    push.connect('testEndWithWrite', function() {
        push.end(msg, 'utf8');
    });
});

// Test we can happily maintain a rolling set of sockets. The main
// concern is leaking event handlers (which node.js shall warn us
// about).
suite.testManySockets = testWithContext(function(done, CTX) {
  var WINDOW = 10;
  var socks = [];
  var types = ['PUB', 'SUB', 'PUSH', 'PULL',
               'REQ', 'REP', 'WORKER'];
  var total = WINDOW * 10;
  var ended = 0;
  function latch() {
    ended++;
    if (ended === total) done();
  }
  for (var i = 0; i < total; i++) {
    var t = types.shift(); types.push(t);
    var s = CTX.socket(t);
    s.on('close', latch);
    socks.push(s);
    s.connect('testManySockets');
    if (i > WINDOW) {
      socks.shift().close();
    }
  }
  var s1; while (s1 = socks.shift()) s1.close();
});

suite.simplestPushPull = testWithContext(function(done, CTX) {
    var push = CTX.socket('PUSH');
    var pull = CTX.socket('PULL');
    var msg = randomString();
    pull.setEncoding('utf8');
    pull.on('data', function(m) {
        assert.equal(msg, m);
        done();
    });

    push.connect('testPushPull', function() {
      push.write(msg);
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

suite.topicPubSub = testWithContext(function(done, CTX) {
  var pub = CTX.socket('PUB', {routing: 'topic'});
  var sub = CTX.socket('SUB', {routing: 'topic'});
  sub.setEncoding('utf8');
  var content = randomString();
  sub.on('data', function(msg) {
    try { assert.equal(content, msg); done(); }
    catch (e) { done(e); }
  });

  sub.connect('testTopicPubSub', 'foo.*', function() {
    pub.connect('testTopicPubSub', function() {
      pub.publish('foo.bar', content, 'utf8');
    });
  });
});

suite.simplestWorker = testWithContext(function(done, CTX) {
  var work = CTX.socket('WORKER');
  work.setEncoding('utf8');
  var send = CTX.socket('PUSH');
  var task = randomString();
  work.on('data', function(msg) {
    work.ack();
    assert.ok(msg == task);
    done();
  });
  send.connect('test-worker', function() {
    work.connect('test-worker', function() {
      send.write(task, 'utf8');
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

suite.outOfOrderReplies = testWithContext(function(done, CTX) {
    var req = CTX.socket('REQ');
    req.setEncoding('utf8');
    var expect = ['first', 'second', 'third'];
    req.on('data', function(msg) {
        if (msg === expect[0]) {
            expect.shift();
            if (expect.length == 0) done();
        }
        else
            done(new Error('Message received out of order: ' + msg));
    });

    var reps = [CTX.socket('REP'),
                CTX.socket('REP'),
                CTX.socket('REP')];

    var inOrder = [null, null, null];

    function sendReplies() {
        inOrder[2].write('third', 'utf8');
        inOrder[1].write('second', 'utf8');
        inOrder[0].write('first', 'utf8');
    }

    function onData(name, msg) {
        switch (msg) {
        case 'one': inOrder[0] = this; break;
        case 'two': inOrder[1] = this; break;
        case 'three': inOrder[2] = this; break;
        }
        if (inOrder[0] && inOrder[1] && inOrder[2]) {
            sendReplies();
        }
    }

    function doConnect(i) {
        if (i < reps.length) {
            reps[i].setEncoding('utf8');
            reps[i].on('data', onData.bind(reps[i], i));
            reps[i].connect('testOutOfOrder',
                            doConnect.bind(null, i+1));
        }
        else {
            req.connect('testOutOfOrder', function() {
                req.write('one', 'utf8');
                req.write('two', 'utf8');
                req.write('three', 'utf8');
            });
        }
    }

    doConnect(0);
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
        sub.connect('testMultiSub', function() {
          doSub(i+1);
        });
    }

    function cont() {
        var pub = CTX.socket('PUB');
        pub.connect('testMultiSub', function() {
            pub.write('multi');
        });
    }

    doSub(0);
});

suite.onePerPull = testWithContext(function(done, CTX) {
    var pulls = [CTX.socket('PULL'),
                 CTX.socket('PULL'),
                 CTX.socket('PULL')];
    var msg = randomString();
    var latch = 3;
    var target = 'testOnePerPull';

    for (var i=0; i < pulls.length; i++) {
        pulls[i].setEncoding('utf8');
        pulls[i].on('data', function(m) {
            if (m == msg) {
                if (--latch === 0) done();
            }
        });
        pulls[i].connect(target);
    }

    var push = CTX.socket('PUSH');
    push.connect(target, function() {
        for (var i=0; i < pulls.length; i++) {
            push.write(msg, 'utf8');
        }
    });
});

suite.expiredPush = testWithContext(function(done, CTX){
  var pull = CTX.socket('PULL');
  pull.setEncoding('utf8');
  
  var push = CTX.socket('PUSH');
  var target = 'testExpiration';

  var pre = randomString();

  function doPull() {
    setTimeout(function() {
      pull.once('data', function (msg) {
        switch (msg) {
        case pre + "Expires":
          return done(new Error("Got expired msg"));
        case pre + "Does not expire":
          return done();
        default: // leftovers
          return doPull();
        }
      });
      pull.connect(target);
    }, 40);
  }

  function send() {
    // the expiration can be small; the point is, it gets expired well
    // before we connect with the pull socket
    push.setsockopt('expiration', 10);
    push.write(pre + 'Expires');
    push.setsockopt('expiration', undefined);
    push.write(pre + 'Does not expire');
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

suite.discardMessage = testWithContext(function(done, CTX) {
  var worker = CTX.socket('WORKER');
  var push = CTX.socket('PUSH');
  worker.connect('test.worker-reject');
  worker.on('data', function(m) {
    worker.discard();
    done();
  });
  push.connect('test.worker-reject', function(_ok) {
    push.write('foobar');
  });
});

suite.requeueMessage = testWithContext(function(done, CTX) {
  var worker1 = CTX.socket('WORKER');
  var worker2 = CTX.socket('WORKER');
  var recvd = false;
  var q = 'test.worker-requeue';

  var push = CTX.socket('PUSH');
  worker1.connect(q);
  worker2.connect(q);

  function recv(msg) {
    if (recvd) {
      this.ack();
      done();
    }
    else {
      this.requeue();
      recvd = true;
    }
  }

  worker1.on('data', recv.bind(worker1));
  worker2.on('data', recv.bind(worker2));

  push.connect(q, function(_ok) {
    push.write('foobar');
  });
});
