// The pool of lambdas is shared by everything that uses the same file, whatever the communication, so the server that communicates through files needs a file of its own.
module.exports = require('./lambda');
