import { procStat } from '../test-helpers/proc-stat';
import type { Snapshot } from '../types/runner';
import { buildRunnerReport } from './build-runner-report';
import { getCpuTimes } from './get-cpu-times';

describe('buildRunnerReport', () => {
  const snapshot = (steal: number): Snapshot => ({
    cpuModel: 'Test CPU 9000',
    cores: 4,
    times: getCpuTimes(procStat(0, 0, 0, steal)),
  });
  const later = (steal: number, total: number): Snapshot => ({
    ...snapshot(steal),
    times: { total, steal },
  });

  it('shows the processor, the cores and the steal time', () => {
    const markdown = buildRunnerReport(snapshot(0), later(2, 200));

    expect(markdown).toContain('| Processor | Test CPU 9000 |');
    expect(markdown).toContain('| Cores | 4 |');
    expect(markdown).toContain('| Steal time during the test | 1.0% |');
    expect(markdown).not.toContain('held back');
  });

  it('warns when a noticeable part of the time was steal', () => {
    expect(buildRunnerReport(snapshot(0), later(30, 200))).toContain('held back by its host');
  });

  it('says n/a for the steal time when there is no second snapshot', () => {
    expect(buildRunnerReport(snapshot(0), undefined)).toContain('| Steal time during the test | n/a |');
  });
});
