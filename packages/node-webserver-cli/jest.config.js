const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-webserver-cli'),
  testEnvironment: 'node',
  setupFilesAfterEnv: [resolve(__dirname, '../../jest-retry.js')],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
