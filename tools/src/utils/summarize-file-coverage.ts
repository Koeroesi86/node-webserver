import { relative } from 'node:path';
import type { FileCoverage, FileSummary } from '../types/coverage';

/** a line counts as covered when every statement that starts on it ran, so a line with one skipped branch is listed as uncovered */
export const summarizeFileCoverage = (coverage: FileCoverage, root: string): FileSummary => {
  const lines = Object.entries(coverage.statementMap).reduce<Map<number, boolean>>((result, [id, { start }]) => {
    result.set(start.line, (result.get(start.line) ?? true) && coverage.s[id] > 0);
    return result;
  }, new Map());

  return {
    file: relative(root, coverage.path).split('\\').join('/'),
    lines: lines.size,
    coveredLines: [...lines.values()].filter(Boolean).length,
    uncoveredLines: [...lines]
      .filter(([, covered]) => !covered)
      .map(([line]) => line)
      .sort((a, b) => a - b),
  };
};
