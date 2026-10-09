const { resolve } = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: [resolve(__dirname, '../../jest-retry.js')],
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-worker'),
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
