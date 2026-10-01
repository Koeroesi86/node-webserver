const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: resolve(__dirname, "../../.cache/jest/node-webserver"),
  // setupFiles: [
  //   "<rootDir>/config/polyfills.js"
  // ],
  testEnvironment: 'node',
  // collectCoverageFrom: [
  //   "*.js"
  // ],
  testMatch: [
    "**/?(*.)+(spec|test).js"
  ],
  moduleFileExtensions: ["js", "json"],
};
