const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../../.cache/jest/node-webserver-integration'),
  testEnvironment: 'node',
  setupFilesAfterEnv: [resolve(__dirname, '../../../jest-retry.js')],
  // the servers take a moment to start, and they are processes with ports of their own
  testTimeout: 60000,
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: resolve(__dirname, 'tsconfig.json'), diagnostics: { ignoreCodes: [151002] } }],
  },
  testMatch: ['**/*.integration.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
