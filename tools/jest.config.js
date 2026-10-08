const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../.cache/jest/tools'),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/load-tests/**/?(*.)+(spec|test).js'],
};
