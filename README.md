# Messaging in Node.JS with RabbitMQ

    $ npm install rabbit.js

This library provides a simple, socket-oriented API* for messaging in
[Node.JS](http://nodejs.org/), using
[RabbitMQ](http://www.rabbitmq.com/) as a backend.

```js
var context = require('rabbit.js').createContext();
context.on('ready', function() {
  var pub = context.socket('PUB'), sub = context.socket('SUB');
  sub.pipe(process.stdout);
  sub.connect('events', function() {
    pub.connect('events', function() {
      pub.write(JSON.stringify({welcome: 'rabbit.js'}), 'utf8');
    });
  });
});
```

See Github pages for [documentation of the most recent
release][gh-pages], and the branch
[gh-pages-next](https://github.com/squaremo/rabbit.js/tree/gh-pages-next)
for provisional documentation of the next release (which usually
corresponds to the code in master branch).

## Status

Still on major version `0`, though in use in a number of places, I
believe.

Version 0.3.0 and on are built on [amqplib][]. Previous versions, of
which version 0.2.2 was the last, used [node-amqp][].

## Uses

This library is suitable for co-ordinating peers (e.g., Node.JS
programs), acting as a gateway to other kinds of network (e.g.,
relaying to browsers via SockJS), and otherwise as a really easy way
to use RabbitMQ.

## Fork features

### Topics
JOB
- provides access to the rabbitMQ message instead of the contents.

The JOB topic allows for asynchronous acking of messages after a
task has completed. So the worker can push the completed message
onto another queue and then ack the original message ensuring that
rabbitMQ always has a message in a queue related to the original
job until all sub-tasks are complete.


```js
var ctx = require('rabbit.js').createContext();
ctx.on('ready', function() {
    var push = ctx.socket('PUSH');
    var nextQ = 'bar-tasks'
    push.connect(nextQ);

  var job = ctx.socket('JOB', {prefetch:64});
  var actionQ = 'foo-tasks';
  job.connect(actionQ);


  function recv(msg) {
    /* Do work
     ...
    */
    var nextMsg = {"data":"data"}
    job.next(msg, push, nextMsg)
  }

  job.on('data', recv.bind(job));
})
```

[amqplib]: https://github.com/squaremo/amqp.node/
[node-amqp]: https://github.com/postwait/node-amqp/
[gh-pages]: https://squaremo.github.io/rabbit.js/
