import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FileCoverage, PackageCoverage } from '../types/coverage';
import { buildCoverageReport, summarizeFileCoverage } from '../utils';

// Merges the istanbul output of `pnpm test:coverage` (`coverage/coverage-final.json` of every package and of the tools) into one markdown report and one json file.
//   node coverage-report.js [workspace-root]

const root = resolve(process.argv[2] ?? resolve(__dirname, '../../..'));
const outputDirectory = resolve(root, 'coverage');

const packages = [...readdirSync(resolve(root, 'packages')).map((name) => resolve(root, 'packages', name)), resolve(root, 'tools')]
  .map((path) => ({ name: path.slice(root.length + 1), coveragePath: resolve(path, 'coverage/coverage-final.json') }))
  .filter(({ coveragePath }) => existsSync(coveragePath))
  .map<PackageCoverage>(({ name, coveragePath }) => ({
    name,
    files: Object.values<FileCoverage>(JSON.parse(readFileSync(coveragePath, 'utf8')))
      .map((file) => summarizeFileCoverage(file, root))
      .sort((a, b) => a.file.localeCompare(b.file)),
  }));

if (packages.length === 0) {
  console.error('No coverage found, run `pnpm test:coverage` first.');
  process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, 'report.md'), buildCoverageReport(packages));
writeFileSync(resolve(outputDirectory, 'report.json'), JSON.stringify(packages, undefined, 2));
console.log(`Coverage report written to ${resolve(outputDirectory, 'report.md')}`);
