import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRequestRate } from './read-request-rate';

describe('readRequestRate', () => {
  const folder = mkdtempSync(join(tmpdir(), 'read-request-rate-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('is the rounded rate of the summary', () => {
    writeFileSync(join(folder, 'summary.json'), JSON.stringify({ metrics: { http_reqs: { rate: 1234.56 } } }));

    expect(readRequestRate(join(folder, 'summary.json'))).toBe('1235 req/s');
  });

  it('says there is no summary when it is missing, broken or without requests', () => {
    writeFileSync(join(folder, 'broken.json'), 'not json');
    writeFileSync(join(folder, 'empty.json'), JSON.stringify({ metrics: {} }));

    expect(readRequestRate(join(folder, 'missing.json'))).toBe('no summary');
    expect(readRequestRate(join(folder, 'broken.json'))).toBe('no summary');
    expect(readRequestRate(join(folder, 'empty.json'))).toBe('NaN req/s');
  });
});
