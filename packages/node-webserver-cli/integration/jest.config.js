const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../../.cache/jest/node-webserver-cli-integration'),
  testEnvironment: 'node',
  setupFilesAfterEnv: [resolve(__dirname, '../../../jest-retry.js')],
  // the servers are processes with ports of their own, which start again during a test
  testTimeout: 60000,
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: resolve(__dirname, 'tsconfig.json'), diagnostics: { ignoreCodes: [151002] } }],
  },
  testMatch: ['**/*.integration.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
