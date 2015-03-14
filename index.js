var sockets = require('./lib/sockets');

module.exports = sockets;
module.exports.createContext = function(url, connOpts) {
  return new sockets.Context(url, connOpts);
}
