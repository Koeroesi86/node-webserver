const { resolve } = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-worker'),
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
