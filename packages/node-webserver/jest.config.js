const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-webserver'),
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['<rootDir>/src/**/?(*.)+(spec|test).ts', '<rootDir>/load-tests/**/?(*.)+(spec|test).js'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
