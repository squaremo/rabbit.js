---
layout: default
title: Messaging for Node.JS made easy
---

This library provides a simple, socket-oriented API* for messaging in
[Node.JS](http://nodejs.org/), using
[RabbitMQ](http://www.rabbitmq.com/) as a backend.

*Yes, rather like ZeroMQ. [See below](#zeromq).

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

## Uses

This library is suitable for co-ordinating peers (e.g., Node.JS
programs), acting as a gateway to other kinds of network (e.g.,
relaying to browsers via SockJS), and otherwise as a really easy way
to use RabbitMQ.

## Installing rabbit.js

    $ npm install rabbit.js

## API

The entry point is `createContext`, which gives you a factory for
sockets. You supply it the URL to your RabbitMQ server:

```js
var context = require('rabbit.js').createContext('amqp://localhost');
```

The context will emit `'ready'` when it's connected.

A context will emit `'error'` with an `Error` object if there's a
problem with the underlying connection to the server. This invalidates
the context and all its sockets.

A context may be disconnected from the server with `#close()`. It will
emit `'close'` once the underlying connection has been terminated, by
you or by an error.

### Sockets

To start sending or receiving messages you need to acquire a socket:

```js
var pub = context.socket('PUBLISH');
var sub = context.socket('SUBSCRIBE');
```

and connect it to something:

```js
pub.connect('alerts');
sub.connect('alerts');
```

Sockets are [Streams][nodejs-stream] in object mode, with buffers as
the objects. In particular, you can `#read()` buffers from those that
are readable (or supply a callback for the `'data'` event, if you are
an adherent of the old ways), and you can `#write()` to those that are
writable.

If you're using strings, you can `setEncoding()` to get strings
instead of buffers as data, and supply the encoding when writing.

```js
sub.setEncoding('utf8');
sub.on('data', function(note) { console.log("Alarum! %s", note); });

pub.write("Emergency. There's an emergency going on", 'utf8');
```

You can also use `#pipe` to forward messages to or from another
stream, making relaying simple:

```js
sub.pipe(process.stdout);
```

A socket may be connected more than once, by calling
`socket.connect(x)` with different `x`s. What this entails depends on
the socket type (see below). Messages to and from different
`connect()`ions are not distinguished. For example

```js
var sub2 = context.socket('SUBSCRIBE');
sub2.connect('system');
sub2.connect('notifications');
```

Here, the socket `sub2` will receive all messages published to
`'system'` and all those published to `'notifications'` as well, but
it is not possible to distinguish among the sources. If you want to do
that, use distinct sockets.

#### `Socket#close` and `Socket#end`

A socket may be closed using `#close()`; this will clean up resources,
and emit `'close'` once it's done so.

A writable socket may be closed with a final write by calling
`#end([chunk [, encoding]])`. Given no arguments, `#end` is the same
as `#close`.

### Socket types

The socket type, passed as the first argument to `Context#socket`,
determines whether the socket is readable and writable, and what
happens to buffers written to it. Socket types are used in the pairs
described below.

**PUBLISH** / **SUBSCRIBE** (also PUB / SUB): every SUB socket
connected to <x> gets messages sent by a PUB socket connected to <x>;
a PUB socket sends every message to each of its connections. SUB
sockets are readable only, and PUB sockets are writable only. The
messages actually received are determined by the parameters with which
the SUB socket is connected, and the topic used by the PUB socket --
see "Topics" below.

**PUSH** / **PULL**: a PUSH socket will send each message to a
single connection, using round-robin. A PULL socket will receive a
share of the messages sent to each <y> to which it is connected,
determined by round-robin at <y>. PUSH sockets are writable only, and
PULL sockets are readable only.

**REQUEST** / **REPLY** (also REQ / REP): a REQ socket sends each
message to one of its connections, and receives replies in turn; a REP
socket receives a share of the messages sent to each <y> to which it
is connected, and must send a reply for each, in the order they come
in. REQ and REP sockets are both readable and writable.

**TASK** / **WORKER**: a TASK socket is connected to one or more
varieties of task, one of which is selected for each message. The task
is selected with the socket option `'task'`. Alternatively, each TASK
socket has the additional method `#post` which is used to supply the
task and the message at the same time.

A WORKER socket is similar to a PULL socket, but requires that you
call `#ack` on it to acknowledge that you have processed each
message. Any messages left unacknowledged when the socket closes, or
crashes, will be requeued and delivered to another connected socket
(should there be one). A worker socket is read-only, and has the
additional method `#ack` which acknowledges the oldest unacknowledged
message, and must be called once only for each message.

A way to maintain ordering for REP and WORKER sockets is shown in the
["ordering" example][ordering-example].

#### Topics and topic patterns

**PUB** and **SUB** sockets have an extra feature: the messages sent
by a PUB socket are routed to SUB sockets according to a topic given
by the PUB socket, and topic patterns given by the SUB socket.

A PUB socket may set its `'topic'` using `#setsockopt('topic',
string)`. All messages sent with `#write` will use that
topic. Alternatively, you can use `#publish(topic, message,
[encoding])` to give the topic per message.

A SUB socket may pass in an additional parameter, in the second
position, to `#connect`. This extra argument is a pattern that is
matched against message topics; how the matching is done depends on
the `'routing'` option given to the sockets (they must agree on the
value):

 - `'fanout'` is the default and means all messages go to all SUB
   sockets, regardless of the topic or topic pattern.
 - `'direct'` means that message topics are matched with patterns
   using string equality.
 - `'topic'` uses AMQP's wildcard matching: briefly, a topic consists
   of `'.'`-delimited words, and a pattern is the same but may contain
   wildcards, `'*'` meaning "any single word" and `'#'` meaning "any
   sequence of words". So, the pattern `"*.bar.#"` will match the
   topic `foo.bar.baz.bam"`. There's a longer explanation in the
   RabbitMQ [tutorial on topic matching][rabbitmq-topic-tute].

Leaving all the options alone, and using only the two-argument version
of `#connect`, all SUB sockets connected to X will get all messages
sent by PUB sockets connected to X.

#### Socket options

Some socket types have options that may be set at any time with
`Socket#setsockopt`, or given a value when the socket is created, in
the second argument to `Context#socket`.

##### `routing` and `topic`

`routing` is supplied to a **PUB** or **SUB** socket on creation, and
determines how it will match topics to topic patterns, as described
under "Topics". Sockets connected to the same address must agree on
the routing.

`topic` may be set on a **PUB** socket to give the topic for
subsequent messages sent using `#write`.

##### `task`

The option `task` is used on a **TASK** socket to select the task for
subsequent messages sent using `#write`.

##### `expiration`

The option `'expiration'` may be set on writable sockets, i.e., PUB,
PUSH, REQ and REP. It is given as a number of milliseconds:

```js
pub.setsockopt('expiration', 60 * 1000)
```

In the example, messages written to `pub` will be discarded by the
server if they've not been delivered after 60,000
milliseconds. Message expiration only works with versions of RabbitMQ
newer than 3.0.0.

You need to be careful when using expiry with a **WORKER**, **REQ** or
**REP** socket, since losing a message will break ordering. Only
sending one request at a time, and giving requests a time limit, may
help.

##### `prefetch`

The option `'prefetch'`, determines how many messages RabbitMQ will
send to the socket before waiting for some to be processed. This only
has a noticable effect for **WORKER** and **REP** sockets. It is best
set when the socket is created, but may be set any time afterwards.

```js
var worker = ctx.socket('WORKER', {prefetch: 1});
```

For instance, if you set `'prefetch'` to `1` on a **WORKER** socket,
RabbitMQ will wait for you to call `#ack` for each message before
sending another. On a **REP** socket, messages are acknowledged when
the reply is written (i.e., `#write` doubles as an `#ack`), so
`'prefetch'` will limit how many replies the socket can have
outstanding.

If you set it to `0`, RabbitMQ will forget any such
constraint and just send what it has, when it has it. The default
value is `0`.

##### `persistent`

The option `'persistent'` governs the lifetime of messages. Setting it
to `true` means RabbitMQ will keep messages over restarts, by writing
them to disk. This is an option for all sockets, and crucially,
sockets connected to the same address must agree on persistence
(because they must all declare the server resources with the same
properties -- an unfortunate technical detail).

In the case of **REQ** and **REP** sockets, the requests may be
persistent, but replies never are; in other words, `'persistent'`
applies only to requests.

In the case of **SUB** and **PUB** sockets, `'persistent'` currently
has no effect, but they may nonetheless have the option set.

Setting this option to `false` using `#setsockopt` means that the
messages following will not survive restarts, and any connections made
while it is `false` will not persist messages. It may be set back
to `true` of course, but this will not affect connections made in the
meantime.

See below for what `'persistent'` means in AMQP terms.

## Using with servers

A few modules have a socket-server-like abstraction; canonically, the
`net` module, but also for example SockJS and Socket.IO. These can be
adapted using something similar to the following.

```js
var context = new require('rabbit.js').createContext('amqp://localhost');
var inServer = net.createServer(function(connection) {
  var s = context.socket('PUB');
  s.connect('incoming', function() {
    connection.pipe(s);
  });
});
inServer.listen(5000);
```

This is a simplistic example: a bare TCP socket won't in general emit
data in chunks that are meaningful to applications, even if they are
sent that way at the far end.

## Examples

Each subdirectory of `example` has code demonstrating using
rabbit.js with other modules. Install the prerequisites for rabbit.js
first:

    rabbit.js$ npm install

Now each example can be run with, e.g.,

    rabbit.js$ cd example/sockjs
    sockjs$ npm install && npm start

All of the examples assume there is a [RabbitMQ server
running](http://rabbit.mq/download.html) locally. The SockJS and
Socket.IO examples both start a website which you can visit at
`http://localhost:8080`.

## <a name="zeromq"></a>Relation to ZeroMQ

rabbit.js was inspired by the [RabbitMQ/ZeroMQ
adapter](http://github.com/rabbitmq/rmq-0mq/) I developed with Martin
Sústrik. The rationale for using RabbitMQ in a ZeroMQ-based network is
largely transferable to rabbit.js:

 * RabbitMQ introduces a degree of monitoring and transparency,
   especially if one uses the web management app;
 * RabbitMQ can bridge to other protocols (notably AMQP and STOMP);
 * RabbitMQ provides reliable, persistent queues if desired

with some additional benefits:

 * since rabbit.js sockets implement the `Stream` interface, one
   can easily pipe messages around
 * using RabbitMQ as a backend obviates some configuration management
   -- just supply all instances the broker URL and you're good to go.
 * there's room in the API for more involved routing and other
   behaviour since AMQP is, well, more complicated let's say.

Here are some notable differences and similarities to ZeroMQ in
rabbit.js's API and semantics.

To start, there's no distinction in rabbit.js between clients and
servers (`connect` and `bind` in ZeroMQ, following the BSD socket
API), since RabbitMQ is effectively acting as a relaying server for
everyone to `connect` to. Relatedly, the argument supplied to
`connect()` is abstract, in the sense that it's just a name rather
than a transport-layer address.

Request and Reply sockets have very similar semantics to those in
ZeroMQ. Repliers must respond to requests in the order that they come
in, and respond exactly once to each request.

There are no DEALER or ROUTER sockets (a.k.a., XREQ and XREQ) in
rabbit.js. In ZeroMQ these are implemented by prefixing messages with
a reverse path, which then requires encoding and thereby complication
when relaying to other streams or protocols. Instead, rabbit.js notes
the reverse path as messages are relayed to a REP socket, and
reapplies it when the response appears (giving rise to the ordering
requirement on replies).

There is no WORKER socket in ZeroMQ; the advice generally given is to
use a REQ/REP pair and convey acknowledgments back to the requester
(which is to retry in the case of failure or more likely,
timeout). Since rabbit.js has RabbitMQ as a reliable intermediary,
this can be cut short, with acknowledgments and retry handled by
RabbitMQ.

## Relation to AMQP and STOMP

rabbit.js makes some simplifying assumptions that must be kept in mind
when integrating with other protocols that RabbitMQ supports.

PUB and SUB sockets declare exchanges named for the argument given to
`#connect` and with the type given by the `'routing'` option. If a
`topic` argument is given to `#connect`, it's used as the routing key
pattern, otherwise `''` is used.

To send to SUB sockets or receive from PUB sockets, publish or bind
(or subscribe in the case of STOMP) to the exchange with the same name
as given to `#connect` and the exchange type given in the `routing`
option.

PUSH, PULL, TASK, WORKER, REQ and REP sockets use non-exclusive queues
named for the argument given to `connect`.

If you are replying to a REQ socket via AMQP or STOMP, be sure to
follow the convention of sending the response to the queue given in
the `'replyTo'` property of the request message, and copying the
`'correlationId'` property from the request in the reply. If you are
REQuesting via AMQP or STOMP, at least supply a `replyTo`, and
consider supplying a `correlationId`, so you can reorder responses.

The option `'persistent'` relates both to the `durable` property of
queues and to the `deliveryMode` property given to messages. If a
socket is `persistent`, it will declare queues as `durable`, and send
messages with `deliveryMode` of `2`. The exceptions are SUB sockets,
which don't declare their subscription queue as durable, although PUB
sockets are allowed to publish persistent (`deliveryMode=2`) messages;
and REQ sockets, which **do** declare the request queue (that they
send to) as durable, but not their own reply queue.

[amqplib]: https://github.com/squaremo/amqp.node/
[node-amqp]: https://github.com/postwait/node-amqp/
[nodejs-stream]: http://nodejs.org/docs/v0.10.21/api/stream.html
[ordering-example]: https://github.com/squaremo/rabbit.js/tree/master/example/ordering
[rabbitmq-topic-tute]: http://www.rabbitmq.com/tutorials/tutorial-five-python.html
