import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('summary script', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'summary-script-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const run = (...args: string[]) => execFileSync('node', [resolve(__dirname, '../../dist/scripts/summary.js'), ...args], { encoding: 'utf8' });

  it('prints the report of the summary export it is given, with the title', () => {
    const path = join(folder, 'k6-summary.json');
    writeFileSync(path, JSON.stringify({ metrics: { http_reqs: { count: 10, rate: 5 } } }));

    expect(run(path, '', 'CPU bound')).toContain('## CPU bound ✅ passed');
    expect(run(path)).toContain('| Requests | 10 (5 req/s) |');
  });

  it('explains that there was no summary, and still succeeds so that the job summary is written', () => {
    expect(run(join(folder, 'missing.json'))).toContain('No k6 summary was produced');
  });
});
