import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { binarySummary, cpuSummary, summary } from '../test-helpers/summaries';
import type { K6Summary } from '../types/k6-summary';

describe('compare script', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'compare-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const write = (name: string, content: K6Summary) => {
    const path = join(folder, name);
    writeFileSync(path, JSON.stringify(content));

    return path;
  };
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('node', [resolve(__dirname, '../../dist/scripts/compare.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

  it('prints the table and exits with 0 when there is no regression', () => {
    const result = run([
      '--base',
      write('b1.json', summary()),
      write('b2.json', summary()),
      '--head',
      write('h1.json', summary()),
      write('h2.json', summary()),
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✅ no regression');
    expect(result.stdout).toContain('Medians of 2 runs of the base and 2 of the pull request');
  });

  it('exits with 1 on a regression, whatever side comes first', () => {
    const base = write('slow-b.json', summary({ rate: 4000 }));
    const head = write('slow-h.json', summary({ rate: 2000 }));

    expect(run(['--base', base, '--head', head]).status).toBe(1);
    expect(run(['--head', head, '--base', base]).status).toBe(1);
  });

  it('takes the limits from the environment', () => {
    const base = write('env-b.json', summary({ rate: 4000 }));
    const head = write('env-h.json', summary({ rate: 3000 }));

    expect(run(['--base', base, '--head', head]).status).toBe(1);
    expect(run(['--base', base, '--head', head], { MAX_THROUGHPUT_DROP: '0.5' }).status).toBe(0);
  });

  it('judges the CPU bound runs after --base-cpu and --head-cpu', () => {
    const args = ['--base', write('c-b.json', summary()), '--head', write('c-h.json', summary())];
    const [fast, slow] = [write('cpu-b.json', cpuSummary({ p95: 12 })), write('cpu-h.json', cpuSummary({ p95: 40 }))];

    expect(run([...args, '--base-cpu', fast, '--head-cpu', fast]).status).toBe(0);
    const result = run([...args, '--base-cpu', fast, '--head-cpu', slow]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('CPU bound');
  });

  it('judges the binary runs after --base-binary and --head-binary', () => {
    const args = ['--base', write('d-b.json', summary()), '--head', write('d-h.json', summary())];
    const [fast, slow] = [write('bin-b.json', binarySummary({ p95: 20 })), write('bin-h.json', binarySummary({ p95: 60 }))];

    expect(run([...args, '--base-binary', fast, '--head-binary', fast]).status).toBe(0);
    const result = run([...args, '--base-binary', fast, '--head-binary', slow]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('binary responses');
  });

  it('fails and says so when a side has no summary', () => {
    const result = run(['--base', join(folder, 'missing.json'), '--head', write('only-h.json', summary())]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('No summary of the base');
  });

  it('ignores the summaries that were not written, as long as one run of each side is there', () => {
    const result = run([
      '--base',
      join(folder, 'gone.json'),
      write('some-b.json', summary()),
      '--head',
      write('some-h.json', summary()),
      join(folder, 'gone-too.json'),
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Medians of 1 runs of the base and 1 of the pull request');
  });
});
