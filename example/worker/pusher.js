var rabbit = require('../../index');
const context = rabbit.createContext();
context.on('ready', function() {
  var pusher = context.socket('PUSH');
  pusher.connect('testChannel', function() {
    var messageId = 'message1';
    var messageId2 = 'message2';
    var messageId3 = 'message3';
    var data1 = {
      messageId: messageId
    };
    var data2 = {
      messageId: messageId2
    };
    var data3 = {
      messageId: messageId3
    };
    pusher.write(JSON.stringify(data1), 'utf8', {
      messageId: messageId
    });
    console.log('Pushed: ', data1);
    pusher.write(JSON.stringify(data2), 'utf8', {
      messageId: messageId2
    });
    console.log('Pushed: ', data2);
    pusher.write(JSON.stringify(data3), 'utf8', {
      messageId: messageId3
    });
    console.log('Pushed: ', data3);
  });
});
