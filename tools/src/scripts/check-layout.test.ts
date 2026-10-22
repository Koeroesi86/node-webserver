import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve(__dirname, '../../dist/scripts/check-layout.js');

describe('check-layout script', () => {
  it('passes for the files that HEAD adds to itself', () => {
    expect(spawnSync('node', [script, 'HEAD'], { encoding: 'utf8' }).stderr).not.toContain('layout of CLAUDE.md: tools/');
  });

  it('fails when the base is not a commit', () => {
    expect(spawnSync('node', [script, 'no-such-ref'], { encoding: 'utf8' }).status).not.toBe(0);
  });
});
