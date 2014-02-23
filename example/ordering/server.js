/*
This is an example of how to respect the ordering constraints of a REP
socket while having to use callbacks.

Run the server

    npm start

then connect using say, `nc localhost 5000`. Type in a bunch of words,
separated by newlines, then a '.' on a line by itself. You'll (most
likely) see the console output say it's getting answers in the wrong
order, but the results sent back to netcat will be in the correct
order.

*/

var context = require('../../index').createContext();

var server = require('net').createServer();
server.on('connection', function(conn) {
  conn.setEncoding('utf8');
  
  var req = context.socket('REQ');
  req.setEncoding('utf8');
  // Any answers we get go to the user
  req.pipe(conn);
  req.connect('uppercase');
  
  // To act like we have a bunch of requests at once, I'll collect
  // lines until I get an '.', then send them all at once.
  var batch = [];
  var ask = function (q) {
    req.write(q, 'utf8');
  }
  function readBatch() {
    var msg; while (msg = conn.read()) {
      msg.split('\n').forEach(function(item) {
        if (item == '.') {
          console.log('Sending batch %s', batch);
          batch.forEach(ask);
          batch = [];
        }
        else if (item != '') {
          batch.push(item);
        }
      });
    }
  }
  conn.on('readable', readBatch);
  readBatch();
});

// This will simulate an asynchronous task, e.g. asking a database for
// something
function uppercaseAsynchronously(str, callback) {
  var delay = Math.random() * 5 * 1000;
  setTimeout(function() {
    callback(str.toUpperCase());
  }, delay);
}

var rep = context.socket('REP');
rep.connect('uppercase');
rep.setEncoding('utf8');

/*
This is the essence of it: requests are given a box and put in a
queue, and the answers written into the box when they arrive. Every
once in a while (in this case, every time there's an answer), we try
to take answers (full boxes) from the front of the queue and write
them to the socket.

I'm using a linked list to queue the answers. You could also use an
array, representing the box for the answer as an index and advancing a
low water mark.
*/
var head = null; var tail = null;
function sendAnswers() {
  while (head != null && head.answer) {
    rep.write('-> ' + head.answer + '\n', 'utf8');
    head = head.next;
  }
}

function enqueue() {
  var next =  {
      answer: false,
      next: null
  };
  if (head == null) {
    tail = head = next;
  }
  else {
    tail.next = next;
    tail = next;
  }
  return next;
}

function processOne(msg) {
  var slot = enqueue();
  uppercaseAsynchronously(msg, function(answer) {
    // Uncommenting this will mean the answers aren't put back in
    // order:
    //rep.write(answer); return;
    slot.answer = answer;
    console.log('Got answer for %s', msg);
    sendAnswers();
  });
}

function process() {
  var msg; while (msg = rep.read()) {
    processOne(msg);
  }
}
rep.on('readable', process);
process();

server.listen(5000);
