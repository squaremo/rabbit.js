var context = require('../../').createContext();

context.on('ready', function() {

  var rep = context.socket('REP');
  rep.connect('sync', function() {
    rep.on('data', function(data) {
      // console.log(Buffer.isBuffer(data));
      rep.write('yo');
    });
  });
});

setInterval(function() {
  // gc && gc();
  var mem = process.memoryUsage();
  process.stdout.write('\r' + Object.keys(mem).map(function(name, i) { return name + ' => ' + (mem[name]/1024/1024).toFixed(4)}).join(' / '));
}, 1000);
