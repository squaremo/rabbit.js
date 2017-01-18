var context = require('../../').createContext();

var sent = 0, received = 0;

context.on('ready', function() {

  var req = context.socket('REQ');

  req.connect('sync', function() {
    req.on('data', function(data) {
      received += 1;
    });

    setInterval(function() {
      // rep.js will fail
      var value = new Buffer(0.5 * 1024 * 1024);
      req.write(value);
      sent += 1;
    }, 50);
  });

});

setInterval(function() {
  // gc && gc();
  var mem = process.memoryUsage();
  memout = process.stdout.write('\r' + Object.keys(mem).map(function(name, i) { return name + ' => ' + (mem[name]/1024/1024).toFixed(4)}).join(' / ') + ' / sent:'+sent+' / received:' + received);
}, 1000);
