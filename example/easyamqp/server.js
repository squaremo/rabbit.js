// Example of using rabbit.js as an easy version of AMQP. Not
// interactive: just fires lots of messages at RabbitMQ, consumes
// them, and reports on the results.

var ctx = require('../../index').createContext();

ctx.on('ready', function() {

  var NUM = 1000000;

  var pub = ctx.socket('PUB');
  var sub = ctx.socket('SUB');

  var now = process.hrtime();
  var i = 0;

  function finish() {
    var since = process.hrtime(now);
    console.log("Sending and receiving %d messages took %d secs",
                i, since[0] + since[1] * Math.pow(10, -9));
    ctx.close();
  }
  process.on('SIGINT', finish);

  console.log('Get ready for %d messages!', NUM);

  sub.connect('easyamqp', function() {
    console.log("Starting consumer...");

    function recv() {
      while(sub.read()) {
        i++;
        if (i % 1000 === 0) console.log("%d messages received...", i);
      }
      if (i < NUM) sub.once('readable', recv);
      else finish();
    }
    recv();

    pub.connect('easyamqp', function() {
      console.log("Starting publisher...");

      var j = 0;
      function send() {
        while (j < NUM && pub.write('foobar')) {
          j++;
          if (j % 1000 === 0) console.log('Sent %d messages', j);
        }
        if (j < NUM) pub.once('drain', send);
      }
      send();
    });

  });

});
ctx.on('error', console.warn);
