// Example of using rabbit.js as an easy version of AMQP. Not
// interactive: just fires lots of messages at RabbitMQ, consumes
// them, and reports on the results.

var ctx = require('../../index').createContext();

ctx.on('ready', function() {
  var exchange = "stressNextJobs"
  var routingKey = "stressRoutingKey"
  var q = 'routed_to_queue';

  var consumerOptions = {routing:'topic',durable:true, prefetch:64}

  var now = process.hrtime(), since = now;
  var i = 0, j = 0;
  var lasti = 0, lastj = 0;

  function report(queueName) {
    var elapsed = process.hrtime(since);
    since = process.hrtime();
    var secs = elapsed[0] + elapsed[1] * Math.pow(10, -9);
    var sent = j - lastj, recv = i - lasti;
    lasti = i; lastj = j;
    console.log('Sent: %d at %d msg/s, Recv: %d at %d msg/s in queue %s',
      sent, (sent / secs).toFixed(1),
      recv, (recv / secs).toFixed(1), queueName);
  }


  var job = ctx.socket('JOB', consumerOptions);
  job.connect(q, exchange, routingKey);

  function recv(msg) {
    job.ack(msg);
    i++;
    if (i % 500 === 0) {
      report(q);
    }
  }

  job.on('data', recv.bind(job));
});
ctx.on('error', console.warn);
