## Messaging with node.js and RabbitMQ

This library implements messaging patterns in node.js, using RabbitMQ.

You can use it as a gateway between socket servers in node.js
(e.g., Socket.IO) and RabbitMQ, or as an intermediary for sockets.

As an example of the first, you might use it to distribute events from
a backend system, through RabbitMQ, to browser clients.

As an example of the second, you migh use it to allow browser clients
to communicate among themselves.

There are three messaging patterns supported, following ZeroMQ and the
RabbitMQ/ZeroMQ bridge:

 - publish/subscribe: pub sockets publish to a rendezvous point; all
   sub sockets connected to the rendezvous point receive the messages.

 - request/reply: req sockets send requests to a rendezvous point,
   which are distributed among the rep sockets connected to the
   rendezvous point.  The replies back through the rep sockets are
   routed back to the req sockets.

 - push/pull: push sockets send messages to a rendezvous point; the
   messages are distributed among the pull sockets connected to the
   rendezvous point.

## MessageStream and MessageServer

These classes are used to decorate byte streams (e.g., `net.Stream`) and
servers (e.g., `net.Server`) respectively. `MessageStream` simply
partitions a byte stream into length-prefixed
messages. `MessageServer` wraps a server to provide `MessageStreams`
instead of streams for connections.

## Sockets

The module `sockets.js` wraps a message server to speak the messaging
patterns using RabbitMQ.  The file `socketserver.js` shows how to do
this with a regular net.Server by wrapping it first in a
`MessageServer`, then using `sockets.listen()`;

You can interact with the socketserver via `MessageStream`s. Run the
socketserver:

    $ node socketserver.js

then from another shell start node and create a couple of sockets:

    $ node
    > var msg = require('./messages'), net = require('net');
    > s1 = new msg.MessageStream(net.createConnection(9000));
    > s1.send('pub');
    > s2 = new msg.MessageStream(net.createConnection(9000));
    > s2.send('sub');
    > s2.on('message', function(m) { console.log(m.toString()); });
    > s1.send('Hello world!');

## rabbit.js and Socket.IO

`MessageStream` is designed to look just like Socket.IO's `Client`
class, and `sockets.listen()` will happily wrap a Socket.IO server. If
you clone Socket.IO-node in the working directory, run `node
socketio.js`, then point your browser at `http://localhost:8080/`
you'll get a familiar demo, this time running through RabbitMQ.

You can also mix this with the socket server above, since they are
both sending messages through RabbitMQ; or, with an AMQP client (note
-- the pub/sub sockets use the exchange amq.fanout by default).

## Getting it running

For the minute you need my fork of node-amqp:

    rabbit.js$ git clone http://github.com/squaremo/node-amqp.git

If you want to run the Socket.IO demo, grab that too:

    rabbit.js$ git clone http://github.com/LearnBoost/Socket.IO-node.git --recursive

You also need RabbitMQ, of course. Follow the [installation
instructions](http://www.rabbitmq.com/install.html), or if you
use homebrew just do

    $ brew install rabbitmq
    ...
    $ rabbitmq-server
