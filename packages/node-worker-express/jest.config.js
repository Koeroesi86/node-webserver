const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, '../../.cache/jest/node-worker-express'),
  testEnvironment: 'node',
  transform: {
    // the build bundles ES modules, the tests run as CommonJS
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', esModuleInterop: true, noImplicitAny: false, skipLibCheck: true } }],
  },
  testMatch: ['**/src/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
