import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('compare-with-base script', () => {
  it('explains the usage and fails without the two checkouts', () => {
    const result = spawnSync('node', [resolve(__dirname, '../../dist/scripts/compare-with-base.js')], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: compare-with-base.js');
  });
});
