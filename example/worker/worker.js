var rabbit = require('../../index');

const context = rabbit.createContext();
context.on('ready', function() {
  var pusher = context.socket('WORKER');
  pusher.setEncoding('utf8');
  pusher.connect('testChannel', function() {
    pusher.on('data', function(result) {
      var data = JSON.parse(result);
      console.log('Received: ', data);
      setTimeout(function() {
        if (data.messageId) {
          console.log('Ack: ', data);
          pusher.ack(data.messageId);
        }
      }, Math.round(Math.random()*1000));
    });
  });
});
