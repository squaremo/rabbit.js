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
var pub = context.socket('PUBLISH');
var sub = context.socket('SUBSCRIBE');
```

and connect it to something:

```js
pub.connect('alerts');
sub.connect('alerts');
```

`Context#socket` can take a second argument, which is an object
containing options to set on the socket at its creation.

```js
var worker = context.socket('WORKER', {persistent: true});
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

#### Connecting sockets

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
connected to <x> gets each message sent by a PUB socket connected to
<x>; a PUB socket sends every message to each of its connections. SUB
sockets are readable only, and PUB sockets are writable only.

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

**PUSH** / **WORKER**: a WORKER socket is similar to a PULL socket,
but requires that you call `#ack` on it to acknowledge that you have
processed each message. Any messages left unacknowledged when the
socket closes, or crashes, will be requeued and delivered to another
connected socket (should there be one). A worker socket is read-only,
and has the additional method `#ack` which acknowledges the oldest
unacknowledged message, and must be called once only for each message.

A way to maintain ordering for REP and WORKER sockets is shown in the
["ordering" example][ordering-example].

#### Socket options

Some socket types have options that may be set at any time with
`Socket#setsockopt`, or given a value when the socket is created, in
the second argument to `Context#socket`.

##### `expiration`

The option `'expiration'` may be set at any time on writable sockets,
i.e., PUB, PUSH, REQ and REP. It is given as a number of milliseconds:

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

In the case of **SUB** and **PUB** sockets, `'persistent'` only has
effect if the **SUB** socket is resumable (see the option
`'resume_name'` below).

Setting this option to `false` using `#setsockopt` means that the
messages following will not survive restarts, and any connections made
while it is `false` will not persist messages. It may be set back
to `true` of course, but this will not affect connections made in the
meantime.

See below for what `'persistent'` means in AMQP terms.

##### `resume_name` and `resume_grace_period`

Using these options when creating a **SUB** socket to keep messages
accumulating after the socket is closed, so another socket can resume
reading from where it left off.

The socket must be given a `'resume_name'` which is used to identify
the connections and messages kept. Successive sockets using the same
`'resume_name'` will receive any messages sent in the meantime. If the
socket is persistent, the connections and messages will survive
restarts.

`'resume_grace_period'`, in milliseconds, is the minimum time that the
connections and messages will be kept while there is no socket using
them. After that time, the connections may be cleaned up, losing any
messages. If not supplied, it defaults to five minutes.

```js
var sub = context.socket('SUB', {resume_name: 'subs.abc123'});
sub.connect('events');
// ...
sub.close();
// ... messages are sent to 'events'
var sub2 = context.socket('SUB', {resume_name: 'subs.abc123'});
// sub2 will be connected to 'events', and have the messages
// sent after sub was closed.
```

See below for what `'resume_*'` mean in AMQP terms.

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
`#connect`. The exchange is durable if the PUB or SUB socket is marked
`persistent`, so that bindings will survive if the subscription queue
does, and `autoDelete`, so it doesn't survive otherwise.

To send to SUB sockets or receive from PUB sockets, publish or bind
(or subscribe in the case of STOMP) to the exchange with the same name
as given to `#connect`.

PUSH, PULL, REQ and REP sockets use non-exclusive queues named for the
argument given to `#connect`. If you are replying via AMQP or STOMP,
be sure to follow the convention of sending the response to the queue
given in the `replyTo` property of the request message, and copying
the `correlationId` property from the request in the reply. If you
are requesting via AMQP or STOMP, at least supply a `replyTo`, and
consider supplying a `correlationId`.

The option `'persistent'` relates both to the `durable` property of
queues and to the `deliveryMode` property given to messages. If a
socket is `persistent`, it will declare queues as `durable`, and send
messages with `deliveryMode` of `2`.

The exceptions are SUB sockets, which won't declare their subscription
queue as durable unless they are persistent **and** resumable,
although PUB sockets are allowed to publish persistent
(`deliveryMode=2`) messages; and REQ sockets, which **do** declare the
request queue (that they send to) as durable, but not their own reply
queue.

The option `'resume_name'` changes the nature of the queue declared by
a SUB socket: instead of being auto-delete and exclusive (to the
connection), and getting a server-generated random name, it is given
the name `'resume_name'` and is not auto-delete or exclusive, so it
survives the channel closing and the AMQP connection
dropping.

`'resume_grace_period'` corresponds to the queue property `x-expires`,
a RabbitMQ extension (available since v2.0.0).


[amqplib]: https://github.com/squaremo/amqp.node/
[node-amqp]: https://github.com/postwait/node-amqp/
[nodejs-stream]: http://nodejs.org/docs/v0.10.21/api/stream.html
[ordering-example]: https://github.com/squaremo/rabbit.js/tree/master/example/ordering
