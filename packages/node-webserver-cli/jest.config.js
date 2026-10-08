const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-webserver-cli'),
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
