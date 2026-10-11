import type { FileSummary, PackageCoverage } from '../types/coverage';
import { formatLineRanges } from './format-line-ranges';

const percent = (covered: number, total: number) => (total === 0 ? 100 : (covered / total) * 100).toFixed(1);

const sum = (files: FileSummary[]) => ({
  lines: files.reduce((total, file) => total + file.lines, 0),
  covered: files.reduce((total, file) => total + file.coveredLines, 0),
});

/**
 * Markdown for people and for models: one table of the packages, then for every package the files that are not fully covered with the
 * line numbers that never ran, which is what is needed to know what to test next.
 */
export const buildCoverageReport = (packages: PackageCoverage[]) => {
  const rows = packages.map(({ name, files }) => {
    const { lines, covered } = sum(files);
    return `| ${name} | ${percent(covered, lines)}% | ${covered} / ${lines} |`;
  });
  const total = sum(packages.flatMap(({ files }) => files));
  const details = packages
    .map(({ name, files }) => ({ name, gaps: files.filter(({ uncoveredLines }) => uncoveredLines.length > 0) }))
    .filter(({ gaps }) => gaps.length > 0)
    .map(({ name, gaps }) =>
      [
        `### ${name}`,
        '',
        '| File | Lines | Uncovered lines |',
        '| --- | --- | --- |',
        ...gaps.map((file) => `| ${file.file} | ${percent(file.coveredLines, file.lines)}% | ${formatLineRanges(file.uncoveredLines)} |`),
      ].join('\n')
    );

  return [
    '# Unit test coverage',
    '',
    `Lines covered: ${percent(total.covered, total.lines)}% (${total.covered} / ${total.lines}). A line is uncovered when a statement on it never ran.`,
    '',
    '| Package | Lines | Covered / total |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...(details.length > 0 ? ['## Files with uncovered lines', '', ...details.flatMap((table) => [table, ''])] : ['Every line is covered.', '']),
  ].join('\n');
};
