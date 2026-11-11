import { buildCoverageReport } from './build-coverage-report';

describe('buildCoverageReport', () => {
  const file = (name: string, coveredLines: number, uncoveredLines: number[]) => ({
    file: name,
    lines: coveredLines + uncoveredLines.length,
    coveredLines,
    uncoveredLines,
  });

  it('lists the packages and, for the files with gaps, the lines that never ran', () => {
    const report = buildCoverageReport([
      { name: 'packages/a', files: [file('packages/a/src/full.ts', 4, []), file('packages/a/src/gap.ts', 2, [3, 4, 9])] },
      { name: 'packages/b', files: [file('packages/b/src/full.ts', 5, [])] },
    ]);

    expect(report).toContain('| packages/a | 66.7% | 6 / 9 |');
    expect(report).toContain('| packages/b | 100.0% | 5 / 5 |');
    expect(report).toContain('| packages/a/src/gap.ts | 40.0% | 3-4, 9 |');
    expect(report).not.toContain('full.ts |');
    expect(report).not.toContain('### packages/b');
  });

  it('says so when everything is covered', () => {
    expect(buildCoverageReport([{ name: 'packages/a', files: [file('a.ts', 1, [])] }])).toContain('Every line is covered.');
  });
});
