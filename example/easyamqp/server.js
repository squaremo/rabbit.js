// Example of using rabbit.js as an easy version of AMQP. Not
// interactive: just fires lots of messages at RabbitMQ, consumes
// them, and reports on the results.

var ctx = require('../../index').createContext();

ctx.on('ready', function() {

  var running = true;
  var pub = ctx.socket('PUB');
  var sub = ctx.socket('SUB');

  var now = process.hrtime(), since = now;
  var i = 0, j = 0;
  var lasti = 0, lastj = 0;

  function report() {
    var elapsed = process.hrtime(since);
    since = process.hrtime();
    var secs = elapsed[0] + elapsed[1] * Math.pow(10, -9);
    var sent = j - lastj, recv = i - lasti;
    lasti = i; lastj = j;
    console.log('Sent: %d at %d msg/s, Recv: %d at %d msg/s',
                sent, (sent / secs).toFixed(1),
                recv, (recv / secs).toFixed(1));
  }

  function finish() {
    running = false;
    var since = process.hrtime(now);
    report();
    ctx.close();
  }
  process.on('SIGINT', finish);

  sub.connect('easyamqp', function() {
    console.log("Starting consumer...");

    function recv() {
      while(sub.read()) {
        i++;
      }
    }
    sub.on('readable', recv);

    pub.connect('easyamqp', function() {
      console.log("Starting publisher...");

      var writable = true;
      function send() {
        while (running && (writable = pub.write('foobar'))) {
          j++;
          if (j % 5000 === 0) {
            report();
            break; // give recv a chance
          }
        }
        if (running && writable) setImmediate(send);
        else {
          //console.log('Waiting for drain at %d', j);
        }
      }
      pub.on('drain', send);
      send();
    });

  });

});
ctx.on('error', console.warn);
