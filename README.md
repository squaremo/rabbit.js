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

*Yes, rather like ZeroMQ. [See below](#zeromq).

## Status

Still on major version `0`, though in use in a number of places, I
believe.

Version 0.3.0 and on are built on [amqplib][]. Previous versions, of
which v0.2.2 was the last, used [node-amqp][].

## Uses

This library is suitable for co-ordinating peers (e.g., Node.JS
programs), acting as a gateway to other kinds of network (e.g.,
relaying to browsers via SockJS), and otherwise as a really easy way
to use RabbitMQ.

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
var pub = context.socket('PUB');
var sub = context.socket('SUB');
```

and connect it to something:

```js
pub.connect('alerts');
sub.connect('alerts');
```

Sockets are [Streams][nodejs-stream] in object mode, with buffers as
the objects. In particular, you can `#read()` buffers from those that
are readable, and you can `#write()` to those that are writable. If
you're using strings, you can `setEncoding()` to get strings instead
of buffers as data, and supply the encoding when writing.

```js
sub.setEncoding('utf8');
sub.on('data', function(note) { console.log("Alarum! " + note); });

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
var sub2 = context.socket('SUB');
sub2.connect('system');
sub2.connect('notifications');
```

Here, the socket `sub2` will receive all messages published to
`'system'` and all those published to `'notifications'` as well, but
it is not possible to distinguish among the sources. If you want to do
that, use distinct sockets.

#### `Socket#setsockopt`

Some socket types have options that may be set with
`#setsockopt`. Presently there's just one option, on PUB, PUSH, REQ
and REP sockets, which is message expiration, given as a number of
milliseconds:

```js
pub.setsockopt('expiration', 60 * 1000)
```

In the example, messages written to `pub` will be discarded by the
server if they've not been delivered after 60,000
milliseconds. Message expiration only works with versions of RabbitMQ
newer than 3.0.0.

You need to be careful when using expiry with a **REQ** or **REP**
socket, since losing a request or reply will break ordering. Only
sending one request at a time, and giving requests a time limit, may
help.

#### `Socket#close` and `Socket#end`

A socket may be closed using `#close()`; this will clean up resources,
and emit `'close'` once it's done so.

A writable socket may be closed with a final write by calling
`#end([chunk [, encoding]])`.

### Socket types

The socket types, passed as an argument to `Context#socket`,
determines whether the socket is readable and writable, and what
happens to buffers written to it. Socket types (but not necessarily
sockets themselves) should be used in the pairs described below.

To make the descriptions a bit easier, we'll say if `connect(x)` is
called on a socket for some <x>, the socket is connected to x and x is
a connection of the socket.

**PUB**lish / **SUB**scribe: every SUB socket connected to <x> gets
each message sent by a PUB socket connected to <x>; a PUB socket
sends every message to each of its connections. SUB sockets are
readable only, and PUB sockets are writable only.

**PUSH** / **PULL**: a PUSH socket will send each message to a
single connection, using round-robin. A PULL socket will receive a
share of the messages sent to each <y> to which it is connected,
determined by round-robin at <y>. PUSH sockets are writable only, and
PULL sockets are readable only.

**REQ**uest / **REP**ly: a REQ socket sends each message to one of its
connections, and receives replies in turn; a REP socket receives a
share of the messages sent to each <y> to which it is connected, and
must send a reply for each, in the order they come in. REQ and REP
sockets are both readable and writable.

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

## Relation to AMQP and STOMP

rabbit.js makes some simplifying assumptions that must be kept in mind
when integrating with other protocols that RabbitMQ supports.

PUB and SUB sockets declare non-durable fanout exchanges named for the
argument given to `connect`. To send to SUB sockets or receive from
PUB sockets, publish or bind (or subscribe in the case of STOMP) to
the exchange with the same name.

PUSH, PULL, REQ and REP sockets use durable, non-exclusive queues
named for the argument given to `connect`. If you are replying via
AMQP or STOMP, be sure to follow the convention of sending the
response to the queue given in the `'replyTo'` property of the request
message, and copying the `'correlationId'` property from the request
in the reply. If you are requesting via AMQP or STOMP, at least supply
a `replyTo`, and consider supplying a `correlationId`.

[amqplib]: https://github.com/squaremo/amqp.node/
[node-amqp]: https://github.com/postwait/node-amqp/
[nodejs-stream]: http://nodejs.org/docs/v0.10.21/api/stream.html
