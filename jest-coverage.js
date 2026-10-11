// what `jest --coverage` (pnpm test:coverage) collects and writes, shared by the jest configs of the packages; without the flag nothing is collected.
// only code that is published: no tests, helpers of tests, examples or the scripts that `files` of node-webserver leaves out
module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/**/*.test-helper.ts', '!src/example/**', '!src/scripts/load-test-*.ts', '!src/configuration.load-test.ts'],
  // json is what tools/src/scripts/coverage-report.ts merges, lcov has the html for developers
  coverageReporters: ['json', 'lcov', 'text-summary'],
};
