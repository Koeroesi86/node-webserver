import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('channel-bench script', () => {
  const script = resolve(__dirname, '../../dist/scripts/channel-bench.js');

  it('measures both channels and prints a row for every case and channel', () => {
    const output = execFileSync('node', [script, 'both', '0.01'], { encoding: 'utf8' });

    const rows = output.trim().split('\n').slice(2);
    expect(rows).toHaveLength(10);
    expect(output).toContain('| 1 MiB body, 4 in flight | ipc |');
    expect(output).toContain('| 1 MiB body, 4 in flight | socket |');
    // a message per second and a body per second are numbers
    rows.forEach((row) => expect(row).toMatch(/\| \d+ \| \d+ \| \d+\.\d \| \d+ \|$/));
  }, 60000);

  it('measures one channel when it is asked to', () => {
    const output = execFileSync('node', [script, 'socket', '0.01'], { encoding: 'utf8' });

    expect(output).toContain('| socket |');
    expect(output).not.toContain('| ipc |');
  }, 60000);

  it('says how to use it when it is given something else', () => {
    const result = spawnSync('node', [script, 'pipe'], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: channel-bench.js');
  });
});
