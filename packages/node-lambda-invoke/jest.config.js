const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-lambda-invoke'),
  testEnvironment: 'node',
  setupFilesAfterEnv: [resolve(__dirname, '../../jest-retry.js')],
  testTimeout: 20000,
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
