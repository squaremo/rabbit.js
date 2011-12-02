# Messaging with Node.js and RabbitMQ

    $ npm install rabbit.js

This library implements messaging patterns in
[node.js](http://nodejs.org/), using
[RabbitMQ](http://www.rabbitmq.com/).

You can use it as a gateway between socket servers in node.js (e.g.,
Socket.IO or net.Server) and RabbitMQ, or as an intermediary for
sockets.

As an example of the first, you might use it to distribute events from
a backend system, through RabbitMQ, to browser clients.

As an example of the second, you might use it to allow node.js
instances to communicate among themselves.

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

(<a href="#running">Skip to "Getting something running"</a>)

## messages.MessageStream and messages.MessageServer

    var msgs = require('rabbit.js/lib/messages');

These classes are used to decorate byte streams (e.g., `net.Stream`) and
servers (e.g., `net.Server`) respectively. `MessageStream` simply
partitions a byte stream into length-prefixed
messages. `MessageServer` wraps a server to provide `MessageStreams`
instead of streams for connections.

## sockets

    var sockets = require('rabbit.js/lib/sockets');

The module `sockets.js` wraps a message server to speak the messaging
patterns using RabbitMQ.

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

## sockets.Server (pipes)

<code>sockets.Server</code> is a server with a method for getting a
connection to it.  This is useful if you want to program with sockets
from inside node.

    $ node
    > var sockets = new require('rabbit.js/lib/sockets');
    > var serv = new sockets.Server();
    > sockets.listen(serv); // the ff not a callback for readability
    > var pub = serv.connect();
    > pub.send('pub');
    > var sub = serv.connect();
    > sub.send('sub');
    > sub.on('message', function(m) {console.log(m);});
    > pub.send('Hello world!');

## Examples

NB The examples run from the source directory and don't use an
'installed' rabbit.js.

### Socket server

The file example/socketserver.js demonstrates using the pipe server
with regular net.createServer.

It creates two socket servers, one for incoming messages and one for
outgoing messages. It then hooks these up through a pipe server -- a
`sockets.Server` -- using push and pull connections.

To play:

    rabbit.js$ NODE_PATH=lib node example/socketserver.js &
    rabbit.js$ nc localhost 5001

and in another term:

    $ nc localhost 5002

If you type in the first term it comes out the second. If you open
another term and connect to 5002, you'll find that messages are
round-robined among the outputs; if you open another connection to
5001 you'll find it also sends to one of the outputs.

### rabbit.js and SockJS

`sockets.listen()` can adapt itself to a SockJS server. There is a
simple example given in `example/sockjs.js`. npm will install SockJS
for you:

    rabbit.js$ npm install sockjs

Run `NODE_PATH=lib node example/sockjs.js` and point your browser at
`http://localhost:8080` to see the example in action.

You can of course mix SockJS with message server or pipes described
above.

### rabbit.js and Socket.IO

`MessageStream` is designed to look just like Socket.IO's `Client`
class, and `sockets.listen()` will happily wrap a Socket.IO
server. npm should install Socket.IO:

    rabbit.js$ npm install socket.io@0.6.18

(that's socket.io from before it decided to become a framework)

Run `NODE_PATH=lib node example/socketio.js`, and point your browser at
`http://localhost:8080/` you'll get a familiar demo, this time running
through RabbitMQ.

You can also mix this with the socket or pipe server above, since they
are both sending messages through RabbitMQ; or, with an AMQP client
(note -- the pub/sub sockets use the exchange amq.fanout by default).

<a name="running"></a>
## Getting something running

In the source directory, get the dependencies:

    rabbit.js$ npm install

You also need RabbitMQ, of course. Follow the [installation
instructions](http://www.rabbitmq.com/install.html), or if you
use homebrew just do

    $ brew install rabbitmq
    ...
    $ rabbitmq-server

Now you can run the examples, e.g.,

    rabbit.js$ npm install sockjs
    rabbit.js$ NODE_PATH=lib node examples/sockjs.js

(and browse to http://localhost:8080/)
