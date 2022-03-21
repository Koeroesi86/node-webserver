const path = require('path');

module.exports = {
  hostname: 'web.localhost',
  protocol: 'http',
  type: 'worker', // 'child'|'lambda'|'worker'
  options: {
    root: path.resolve(__dirname, 'worker'),
    index: [
      'index.js'
    ]
  },
};
