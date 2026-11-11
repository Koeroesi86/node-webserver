import { existsSync, readFileSync } from 'node:fs';
import type { ComparisonResult, SummaryPaths } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { compareSummaries } from './compare-summaries';
import { limitsFromEnvironment } from './limits-from-environment';

const load = (paths: string[] = []): K6Summary[] => paths.filter((path) => existsSync(path)).map((path) => JSON.parse(readFileSync(path, 'utf8')));

/** compares the summaries in the files, the ones that were not written are left out, as long as one run of each side is there */
export const compareFiles = (paths: SummaryPaths): ComparisonResult => {
  const [base, head] = [load(paths.base), load(paths.head)];

  if (base.length === 0 || head.length === 0) {
    return {
      passed: false,
      markdown: `## Comparison with the base\n\n❌ ${
        base.length === 0 ? 'No summary of the base' : 'No summary of the pull request'
      } was produced, the runs failed. Check the step logs.`,
    };
  }

  const { markdown, passed } = compareSummaries(base, head, limitsFromEnvironment(), {
    baseCpu: load(paths.baseCpu),
    headCpu: load(paths.headCpu),
    baseBinary: load(paths.baseBinary),
    headBinary: load(paths.headBinary),
  });

  return { markdown, passed };
};
