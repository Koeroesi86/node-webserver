const path = require('path');

module.exports = {
  serverOptions: {
    hostname: 'web.localhost',
    protocol: 'http',
  },
  workerOptions: {
    root: path.resolve(__dirname, './worker'),
    index: [
      'exampleWorker.js'
    ]
  },
};
