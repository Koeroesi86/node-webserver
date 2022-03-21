const path = require('path');

module.exports = {
  hostname: 'web.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: path.resolve(__dirname, './worker'),
    index: [
      'exampleWorker.js'
    ]
  },
};
