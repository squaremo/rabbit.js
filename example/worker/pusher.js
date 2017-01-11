var rabbit = require('../../index');

const context = rabbit.createContext();
context.on('ready', function() {
  var pusher = context.socket('PUSH');
  pusher.connect('testChannel', function() {
    var messageId = Date.now().toString();
    var data = {
      messageId: messageId
    };
    pusher.write(JSON.stringify(data), 'utf8', {
      messageId: messageId
    });
    console.log('Pushed: ', data);
  });
});
