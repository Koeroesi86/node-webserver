const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-lambda-invoke'),
  testEnvironment: 'node',
  testTimeout: 20000,
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['<rootDir>/src/**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
