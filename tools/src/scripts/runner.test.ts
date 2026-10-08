import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { procStat } from '../test-helpers/proc-stat';

describe('runner script', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'runner-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    execFileSync('node', [resolve(__dirname, '../../dist/scripts/runner.js'), ...args], {
      encoding: 'utf8',
    });

  it('writes a snapshot from the files it is given and reports on two of them', () => {
    writeFileSync(join(folder, 'stat1'), procStat(100, 0, 800, 0));
    writeFileSync(join(folder, 'stat2'), procStat(300, 0, 1500, 100));
    writeFileSync(join(folder, 'cpuinfo'), 'model name\t: Fake CPU\n');
    writeFileSync(join(folder, 'before.json'), run('snapshot', join(folder, 'stat1'), join(folder, 'cpuinfo')));
    writeFileSync(join(folder, 'after.json'), run('snapshot', join(folder, 'stat2'), join(folder, 'cpuinfo')));

    const markdown = run('report', join(folder, 'before.json'), join(folder, 'after.json'));

    expect(markdown).toContain('| Processor | Fake CPU |');
    expect(markdown).toContain('| Steal time during the test | 10.0% |');
  });

  it('works on a machine without /proc', () => {
    writeFileSync(join(folder, 'none.json'), run('snapshot', join(folder, 'missing-stat'), join(folder, 'missing-cpuinfo')));

    expect(run('report', join(folder, 'none.json'))).toContain('| Steal time during the test | n/a |');
  });

  it('explains the usage and fails for an unknown command', () => {
    expect(() => run('nothing')).toThrow();
  });
});
