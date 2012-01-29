## Fixes

## Wishlist

 * Client library that e.g., keeps track of the req/rep state machine

## Ideas

 * Use Rabbit-STOMP's idea of destinations
 * or: pass options to Context#socket or in subsequent sockopts
 * (for rep/req) Keep buffer of reply addresses
 * sockopt for using confirms (when implemented in client)

## (Done)

 * Make sure temp queues get tidied up

## (Junked)

 * MessageStream should 'inherit' from Stream, possibly
 * 'Direct mode' client in node
   (the two above obviated by treating sockets as streams)
 * Include topics and subscriptions in sockets (third part of message?)
   (better idea: sockopts or options to context.socket)
