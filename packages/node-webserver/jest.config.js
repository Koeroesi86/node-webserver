const { resolve } = require('path');

module.exports = {
  verbose: true,
  rootDir: resolve(__dirname),
  cacheDirectory: "<rootDir>/.cache/jest",
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
