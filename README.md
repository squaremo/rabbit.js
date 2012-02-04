# Messaging in Node.JS with RabbitMQ

    $ npm install rabbit.js

This library provides a simple, socket-oriented API* for messaging in
[node.js](http://nodejs.org/), using
[RabbitMQ](http://www.rabbitmq.com/) as a backend.

    var context = require('rabbit.js').createContext();
    var pub = context.socket('PUB'), sub = context.socket('SUB');
    sub.pipe(process.stdout);
    sub.connect('events');

    pub.connect('events');
    pub.write(JSON.stringify({welcome: 'rabbit.js'}), 'utf8');

*Yes, rather like ZeroMQ. [See below](#zeromq).

## Uses

This library is suitable for co-ordinating peers (e.g., Node.JS
programs), acting as a gateway to other kinds of network (e.g.,
relaying to browsers via SockJS), or simply as a really easy way to
use RabbitMQ.

## API

The entry point is `createContext`, which gives you a factory for
sockets. You supply it the URL to your RabbitMQ server:

    var context = require('rabbit.js').createContext('amqp://localhost');

To start sending or receiving messages you need to acquire a socket:

    var pub = context.socket('PUB');
    var sub = context.socket('SUB');

and connect it to something:

    pub.connect('alerts');
    sub.connect('alerts');

Sockets act like
[Streams](http://nodejs.org/docs/latest/api/streams.html); in
particular you will get `'data'` events from those that are readable,
and you can `write()` to those that are writable. If you're expecting
data that is encoded strings, you can `setEncoding()` to get strings
instead of buffers as data events.

    sub.setEncoding('utf8');
    sub.on('data', function(note) { console.log("Alarum! " + note); });
    
    pub.write("Emergency. There's an emergency going on", 'utf8');

You can also use pipe to forward messages to or from another stream,
making relaying simple:

    sub.pipe(process.stdout);

Lastly, note that a socket may be connected more than once, by calling
`socket.connect(x)` with different `x`s. What this entails depends on
the socket type (see below), but messages to and from different
`connect()`ions are not distinguished. For example

    var sub2 = context.socket('SUB');
    sub2.connect('system');
    sub2.connect('notifications');

Here, the socket `sub2` will receive all messages published to
`'system'` and all those published to `'notifications'` as well, but
it is not possible to discriminate between the sources.

### Socket types

The socket types, passed as an argument to `Context#socket`, determine
whether the socket is readable and writable, and what happens to
messages written to it. Socket types (but not necessarily sockets
themselves) should be used in the pairs described below.

To make the descriptions a bit easier, we'll say if
`connect(x)` is called on a socket for some `x`, the socket has a
connection to x.

**PUB**lish/**SUB**scribe: every SUB socket connected to <x> gets
each message sent by a PUB socket connected to <x>; a PUB socket
sends every message to each of its connections. SUB sockets are
readable only, and PUB sockets are writable only.

**PUSH**/**PULL**: a PUSH socket will send each message to a
single connection, using round-robin. A PULL socket will receive a
share of the messages sent to each <y> to which it is connected,
determined by round-robin at <y>. PUSH sockets are writable only, and
PULL sockets are readable only.

**REQ**uest/**REP**ly: a REQ socket sends each message to one of
its connections, and receives replies in turn; a REP socket receives a
share of the messages sent to each <y> to which it is connected, and
must send a reply in turn. REQ and REP sockets are both readable and
writable.

## Subscriptions and topics

By default messages sent through a PUB socket to an address will go to
all SUB sockets connected to that address. Sometimes you want finer
control over routing. For example, if you want to be able to address
messages to specific users, but not have to have a socket per user.

For this purpose you can use structured addresses to specify different
varieties of routing, and give messages topics by which it is
routed. Instead of a string as an address, you supply an object with
the address and the additional properties `routing` (the kind of
routing) and for SUB sockets, `pattern` (the subscription
pattern). When using a PUB socket so connected, you use
`socket#setsockopt` to set the topic of the next message.

    var sub = context.socket('SUB');
    sub.connect({address: 'users',
                 pattern: 'mikeb',
                 routing: 'direct'});
    var pub = context.socket('PUB');
    pub.connect({address: 'users', routing: 'direct'});
    pub.setsockopt('topic', 'mikeb');
    pub.write('Hello mikeb!');

### Varieties of routing

The kinds of routing available, unsurprisingly, correspond to
RabbitMQ's exchange types. In an unmodified installation, these are:

 - **fanout** This is what you get if you just use a string for the
     address. Topics and patterns are ignored, and all messages go to
     all subscribers.

 - **direct** A message with a topic T goes to all subscribers that
     connected with a pattern of exactly T.

 - **topic** This uses matching with wildcards. Topics are
     dot-delimited, e.g., `"event.catastrophic.server3"` and patterns
     likewise, with `'*'` standing in for a single segment, and `'#'`
     standing in for zero or more segments. For example, both
     `"event.*.server3"` and `"event.#"` would match the topic
     above. (NB I did not invent this scheme.)

## Using with servers

A few modules have a socket-server-like abstraction; canonically, the
`net` module, but also for example SockJS and Socket.IO. These can be
adapted using something similar to the following.

    var context = new require('rabbit.js').createContext('amqp://localhost');
    var inServer = net.createServer(function(connection) {
      var s = context.socket('PUB');
      s.connect('incoming');
      connection.pipe(s);
    });
    inServer.listen(5000);

This is a simplistic example; a bare TCP socket won't in general emit
data in chunks that are meaningful to applications, even if they are
written that way at the far end. A library such as
[spb](https://github.com/squaremo/node-spb) can be used encode and
decode message streams in byte streams if needed.

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
ZeroMQ. Requesting sockets must take care not to issue more than
request at a time, or to label requests (and rely on repliers
preserving the label in replies) such that the answers can be
correlated with the requests. Actually this is much the same as
ZeroMQ; it follows from the possibility of replies coming back out of
order due to round-robining. Repliers must respond to requests in the
order that they come in, and respond exactly once to each request.

There are no DEALER or ROUTER sockets (a.k.a., XREQ and XREQ) in
rabbit.js. In ZeroMQ these are implemented by prefixing messages with
a reverse path, which then requires encoding and thereby complication
when relaying to other streams or protocols. Instead, rabbit.js notes
the reverse path as messages are relayed to a REP socket, and
reapplies it when the response appears (giving rise to the ordering
requirement on repliers).

## Relation to AMQP and STOMP

rabbit.js makes some simplifying assumptions that must be kept in mind
when integrating with other protocols that RabbitMQ supports.

PUB and SUB sockets declare non-durable fanout exchanges named for the
argument given to `connect`. To send to SUB sockets or receive from
PUB sockets, publish or bind (or subscribe in the case of STOMP) to
the exchange with the same name.

PUSH, PULL, REQ and REP sockets use durable, non-exclusive queues
named for the argument given to `connect`. If you are replying, be
sure to follow the convention of sending the response to the queue
given in the `'replyTo'` property of the request message.

## What happened to `listen()`?

I removed it. It wasn't entirely wrong, but it did have two failings:
firstly, it exposed the socket type and the address to the (end)
client, while the client ought not to need know about them; secondly,
and more fatally, it required a dedicated client connection per
socket, which is a problem for e.g., browsers.

The new API avoids these problems by not requiring any particular
behaviour from a client connection -- that is totally up to you (if
you even use any client connections). If you need to multiplex on a
client connection you can do that by, say, prefixing each message with
a channel name; or, as the Socket.IO example does, combine two simplex
sockets onto a duplex client connection.
