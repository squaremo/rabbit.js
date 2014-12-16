// Example of using rabbit.js as an easy version of AMQP. Not
// interactive: just fires lots of messages at RabbitMQ, consumes
// them, and reports on the results.

var ctx = require('../../index').createContext();

var msg =  medMsg = "asdfasdf";
console.log("Message size = " + msg.length)
ctx.on('ready', function() {

  var running = true;
  var pub = ctx.socket('PUSH');

  var now = process.hrtime(), since = now;
  var i = 0, j = 0;
  var lasti = 0, lastj = 0;

  function report(queueName) {
    var elapsed = process.hrtime(since);
    since = process.hrtime();
    var secs = elapsed[0] + elapsed[1] * Math.pow(10, -9);
    var sent = j - lastj, recv = i - lasti;
    lasti = i; lastj = j;
    console.log('Sent: %d at %d msg/s, Recv: %d at %d msg/s of length %d in queue %s',
      sent, (sent / secs).toFixed(1),
      recv, (recv / secs).toFixed(1), msg.length, queueName);
  }

  function finish() {
    running = false;
    var since = process.hrtime(now);
    report();
    ctx.close();
  }
  process.on('SIGINT', finish);


  pub.connect('easyamqp.async', function() {
    console.log("Starting publisher...");

    var writable = true;
    function send() {
      while (running && (writable = pub.write(msg))) {
        j++;
        if (j % 500 === 0) {
          report('easyamqp.async');
          if (j % 2500 === 0) {
            msg += medMsg;
          }
          break; // give recv a chance
        }
      }
      if (running && writable) setImmediate(send);
      else {
        console.log('Waiting for drain at %d', j);
      }
    }
    pub.on('drain', send);
    send();

  });
});
ctx.on('error', console.warn);
