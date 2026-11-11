import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binarySummary, cpuSummary, summary } from '../test-helpers/summaries';
import type { K6Summary } from '../types/k6-summary';
import { compareFiles } from './compare-files';

describe('compareFiles', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'compare-files-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const write = (name: string, content: K6Summary) => {
    const path = join(folder, name);
    writeFileSync(path, JSON.stringify(content));

    return path;
  };

  it('passes when the pull request is as fast as the base', () => {
    const { passed, markdown } = compareFiles({ base: [write('b1.json', summary())], head: [write('h1.json', summary())] });

    expect(passed).toBe(true);
    expect(markdown).toContain('✅ no regression');
  });

  it('does not pass on a regression', () => {
    expect(compareFiles({ base: [write('b2.json', summary())], head: [write('h2.json', summary({ rate: 2000 }))] }).passed).toBe(false);
  });

  it('judges the CPU bound runs when there are some', () => {
    const [base, head] = [write('b3.json', summary()), write('h3.json', summary())];
    const result = compareFiles({
      base: [base],
      head: [head],
      baseCpu: [write('cb3.json', cpuSummary({ p95: 12 }))],
      headCpu: [write('ch3.json', cpuSummary({ p95: 40 }))],
    });

    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('CPU bound');
  });

  it('judges the binary runs when there are some', () => {
    const [base, head] = [write('b6.json', summary()), write('h6.json', summary())];
    const result = compareFiles({
      base: [base],
      head: [head],
      baseBinary: [write('bb6.json', binarySummary({ p95: 20 }))],
      headBinary: [write('hb6.json', binarySummary({ p95: 60 }))],
    });

    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('binary responses');
  });

  it('ignores the summaries that were not written, as long as one run of each side is there', () => {
    const { passed, markdown } = compareFiles({ base: [join(folder, 'gone.json'), write('b4.json', summary())], head: [write('h4.json', summary())] });

    expect(passed).toBe(true);
    expect(markdown).toContain('Medians of 1 runs of the base and 1 of the pull request');
  });

  it('fails and says which side has no summary', () => {
    const missing = join(folder, 'missing.json');

    expect(compareFiles({ base: [missing], head: [write('h5.json', summary())] })).toEqual({
      passed: false,
      markdown: expect.stringContaining('No summary of the base'),
    });
    expect(compareFiles({ base: [write('b5.json', summary())], head: [missing] }).markdown).toContain('No summary of the pull request');
  });
});
