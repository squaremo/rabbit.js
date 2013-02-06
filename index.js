var sockets = require('./lib/sockets');

module.exports.createContext = function(opts) {
  return new sockets.Context(opts);
};

module.exports.Settings = sockets.Settings;
module.exports.Exchange = sockets.Exchange;
module.exports.Queue = sockets.Queue;
