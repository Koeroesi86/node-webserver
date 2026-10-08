import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { procStat } from '../test-helpers/proc-stat';
import { takeSnapshot } from './take-snapshot';

describe('takeSnapshot', () => {
  const folder = mkdtempSync(join(tmpdir(), 'take-snapshot-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('reads the processor and the times from the files it is given', () => {
    writeFileSync(join(folder, 'stat'), procStat(100, 0, 800, 30));
    writeFileSync(join(folder, 'cpuinfo'), 'model name\t: Fake CPU\n');

    expect(takeSnapshot(join(folder, 'stat'), join(folder, 'cpuinfo'))).toEqual({
      cpuModel: 'Fake CPU',
      cores: expect.any(Number),
      times: { total: 930, steal: 30 },
    });
  });

  it('does not know the times on a machine without /proc, and asks node for the processor', () => {
    const snapshot = takeSnapshot(join(folder, 'missing-stat'), join(folder, 'missing-cpuinfo'));

    expect(snapshot.times).toBeUndefined();
    expect(snapshot.cpuModel).toEqual(expect.any(String));
  });
});
