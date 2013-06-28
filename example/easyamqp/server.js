// Example of using rabbit.js as an easy version of AMQP. Not
// interactive: just fires lots of messages at RabbitMQ, consumes
// them, and reports on the results.

var ctx = require('../../index').createContext();

ctx.on('ready', function() {

  var NUM = 1000000;

  var pub = ctx.socket('PUB');
  var sub = ctx.socket('SUB');

  var now = process.hrtime();

  console.log('Get ready for %d messages!', NUM);

  sub.connect('easyamqp', function() {
    console.log("Starting consumer...");

    var i = 0;
    function recv() {
      while(sub.read()) {
        i++;
        if (i % 1000 === 0) console.log("%d messages received...", i);
      }
      if (i < NUM) sub.once('readable', recv);
      else {
        var since = process.hrtime(now);
        console.log("Sending and receiving %d messages took %d secs",
                    NUM, since[0] + since[1] * Math.pow(10, -9));
        ctx.close();
      }
    }
    recv();

    pub.connect('easyamqp', function() {
      console.log("Starting publisher...");

      var i = 0;
      function send() {
        while (i < NUM && pub.write('foobar')) {
          i++;
          if (i % 1000 === 0) console.log('Sent %d messages', i);
        }
        if (i < NUM) pub.once('drain', send);
      }
      send();
    });

  });

});
ctx.on('error', console.warn);
process.on('SIGINT', ctx.close.bind(ctx));
