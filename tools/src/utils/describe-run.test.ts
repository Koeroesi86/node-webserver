import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeRun } from './describe-run';

describe('describeRun', () => {
  const folder = mkdtempSync(join(tmpdir(), 'describe-run-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('has the rate, the failed requests, the checks and the slowest route of the summary', () => {
    writeFileSync(
      join(folder, 'summary.json'),
      JSON.stringify({
        metrics: {
          http_reqs: { rate: 1234.56 },
          http_req_failed: { value: 0.0123 },
          checks: { value: 0.9877 },
          http_req_duration: { 'p(95)': 900 },
          'http_req_duration{route:worker}': { 'p(95)': 6.64 },
          'http_req_duration{route:lambda}': { 'p(95)': 567.04 },
        },
      })
    );

    expect(describeRun(join(folder, 'summary.json'))).toBe('1235 req/s, 1.23% failed, checks 98.77%, slowest p95 lambda 567.0 ms');
  });

  it('adds the steal time when it is known', () => {
    writeFileSync(join(folder, 'steal.json'), JSON.stringify({ metrics: { http_reqs: { rate: 10 }, http_req_failed: { value: 0 }, checks: { value: 1 } } }));

    expect(describeRun(join(folder, 'steal.json'), 7.25)).toBe('10 req/s, 0.00% failed, checks 100.00%, steal 7.3%');
  });

  it('says there is no summary when it is missing or broken, and n/a for what the summary does not have', () => {
    writeFileSync(join(folder, 'broken.json'), 'not json');
    writeFileSync(join(folder, 'empty.json'), JSON.stringify({ metrics: {} }));

    expect(describeRun(join(folder, 'missing.json'))).toBe('no summary');
    expect(describeRun(join(folder, 'broken.json'))).toBe('no summary');
    expect(describeRun(join(folder, 'empty.json'))).toBe('n/a req/s, n/a failed, checks n/a');
  });
});
