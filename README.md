# Messaging with Node.js and RabbitMQ

This library implements messaging patterns in
[node.js](http://nodejs.org/)), using
[RabbitMQ](http://www.rabbitmq.com/).

You can use it as a gateway between socket servers in node.js (e.g.,
Socket.IO or net.Server) and RabbitMQ, or as an intermediary for
sockets.

As an example of the first, you might use it to distribute events from
a backend system, through RabbitMQ, to browser clients.

As an example of the second, you might use it to allow browser clients
to communicate among themselves.

There are three messaging patterns supported, following
[ZeroMQ](http://zeromq.org/) and the [RabbitMQ/ZeroMQ
bridge](http://github.com/rabbitmq/rmq-0mq/):

 - publish/subscribe: pub sockets publish to a rendezvous point; all
   sub sockets connected to the rendezvous point receive the messages.

 - request/reply: req sockets send requests to a rendezvous point,
   which are distributed among the rep sockets connected to the
   rendezvous point.  The replies back through the rep sockets are
   routed back to the originating req sockets.

 - push/pull: push sockets send messages to a rendezvous point; the
   messages are distributed among the pull sockets connected to the
   rendezvous point.

(<a href="#running">Skip to "Getting it running"</a>)

## messages.MessageStream and messages.MessageServer

These classes are used to decorate byte streams (e.g., `net.Stream`) and
servers (e.g., `net.Server`) respectively. `MessageStream` simply
partitions a byte stream into length-prefixed
messages. `MessageServer` wraps a server to provide `MessageStreams`
instead of streams for connections.

## sockets

The module `sockets.js` wraps a message server to speak the messaging
patterns using RabbitMQ.  The file `examples/socketserver.js` shows
how to do this with a regular net.Server by wrapping it first in a
`MessageServer`, then using `sockets.listen()`. You need RabbitMQ to
be running for this to work of course.

The sockets need a tiny bit of protocol on connection; the first
message sent must be the intended socket type -- one of 'pub', 'sub',
'push', 'pull', 'req', 'rep' -- plus a space, plus the name of a
"rendezvous point" (which will correspond to an AMQP exchange or
queue).  For example, `"pub amq.topic"`.  The rendezvous point will be
created for you if necessary.

The rendezvous is optional for pub and sub sockets, which will use the
`amq.fanout` exchange by default (but it is better to provide one,
unless you want all messages from all pub sockets going to all
subscribed sockets).

You can supply an `allowed` option to `sockets.listen()`, which will
be used for access control. It is simply a map of rendezvous names to
allowed socket types; e.g.,

    $ sockets.listen(svr, {allowed: {'chat': ['pub', 'sub'],
                                     'requests': ['req', 'rep']}});

The option `url` takes an [AMQP
URL](http://rdoc.info/github/ruby-amqp/amqp/master/file/docs/ConnectingToTheBroker.textile#Using_connection_strings)
for connection to RabbitMQ. It defaults to a server running on
localhost.

You can interact with the socketserver via `MessageStream`s. Run the
socketserver:

    $ node example/socketserver.js

then from another shell start node and create a couple of sockets:

    $ node
    > var msg = require('./messages'), net = require('net');
    > s1 = new msg.MessageStream(net.createConnection(9000));
    > s1.send('pub');
    > s2 = new msg.MessageStream(net.createConnection(9000));
    > s2.send('sub');
    > s2.on('message', function(m) { console.log(m.toString()); });
    > s1.send('Hello world!');

## sockets.Server (pipes)

<code>sockets.Server</code> is a server with a method for getting a
connection to it.  This is useful if you want to program with sockets
from inside node.

    $ node
    > var socks = new require('./sockets');
    > var serv = new socks.Server();
    > socks.listen(serv); // the ff not a callback for readability
    > var pub = serv.connect();
    > pub.send('pub');
    > var sub = serv.connect();
    > sub.send('sub');
    > sub.on('message', function(m) {console.log(m);});
    > pub.send('Hello world!');

## rabbit.js and Socket.IO

`MessageStream` is designed to look just like Socket.IO's `Client`
class, and `sockets.listen()` will happily wrap a Socket.IO
server. npm should install Socket.IO:

    $ npm install socket.io@0.6.17

(that's socket.io from before it decided to become a framework)

Run `node example/socketio.js`, and point your browser at
`http://localhost:8080/` you'll get a familiar demo, this time running
through RabbitMQ.

You can also mix this with the socket or pipe server above, since they
are both sending messages through RabbitMQ; or, with an AMQP client
(note -- the pub/sub sockets use the exchange amq.fanout by default).

<a name="running"></a>
## Getting it running

In the repo directory, get the dependencies:

    rabbit.js$ npm install
    rabbit.js$ npm install socket.io@0.6.17

You also need RabbitMQ, of course. Follow the [installation
instructions](http://www.rabbitmq.com/install.html), or if you
use homebrew just do

    $ brew install rabbitmq
    ...
    $ rabbitmq-server

Now you can run the examples, e.g.,

    $ node examples/socketio.js

(and browse to http://localhost:8080/)
