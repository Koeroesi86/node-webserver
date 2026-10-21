const { resolve } = require('path');

// the setup of the tests of node-worker (the pool) (they are the same kind: processes and sockets), with a root and a cache of its own
module.exports = {
  ...require('../node-worker/jest.config.js'),
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-worker-express'),
};
