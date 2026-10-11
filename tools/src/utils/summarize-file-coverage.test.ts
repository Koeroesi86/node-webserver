import { summarizeFileCoverage } from './summarize-file-coverage';

const at = (line: number) => ({ start: { line }, end: { line } });

describe('summarizeFileCoverage', () => {
  it('counts the lines whose statements all ran, and lists the others', () => {
    const summary = summarizeFileCoverage(
      { path: '/repo/packages/a/src/a.ts', statementMap: { 0: at(1), 1: at(2), 2: at(2), 3: at(5) }, s: { 0: 3, 1: 1, 2: 0, 3: 0 } },
      '/repo'
    );

    expect(summary).toEqual({ file: 'packages/a/src/a.ts', lines: 3, coveredLines: 1, uncoveredLines: [2, 5] });
  });
});
