var sockets = require('./lib/sockets');

module.exports = sockets;
module.exports.createContext = function(url) {
  return new sockets.Context(url);
}