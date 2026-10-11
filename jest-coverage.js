// what `jest --coverage` (pnpm test:coverage) collects and writes, shared by the jest configs of the packages; without the flag nothing is collected
module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/k6/**', '!src/test-helpers/**'],
  // json is what tools/src/scripts/coverage-report.ts merges, lcov has the html for developers
  coverageReporters: ['json', 'lcov', 'text-summary'],
};
