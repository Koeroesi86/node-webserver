const { execFileSync } = require('child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, resolve } = require('path');
const { getCpuModel, getCpuTimes, stealPercent, report } = require('./runner');

const stat = (user, system, idle, steal) => `cpu  ${user} 0 ${system} ${idle} 0 0 0 ${steal} 0 0\ncpu0 1 1 1 1 0 0 0 1 0 0\n`;

describe('runner', () => {
  describe('getCpuModel', () => {
    it('reads the model of the processor from /proc/cpuinfo', () => {
      expect(getCpuModel('processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD EPYC 7763 64-Core Processor\ncpu MHz\t\t: 2445.4\n')).toBe(
        'AMD EPYC 7763 64-Core Processor'
      );
    });

    it('knows the field of ARM machines', () => {
      expect(getCpuModel('processor : 0\nModel : Raspberry Pi 4\n')).toBe('Raspberry Pi 4');
    });

    it('asks node when there is no /proc/cpuinfo', () => {
      expect(getCpuModel(undefined)).toEqual(expect.any(String));
    });
  });

  describe('getCpuTimes', () => {
    it('adds up the time of all cores and takes the steal time out of the first line', () => {
      expect(getCpuTimes(stat(100, 50, 800, 30))).toEqual({
        total: 980,
        steal: 30,
      });
    });

    it('does not know the times without the line, or with a line that is too short', () => {
      expect(getCpuTimes(undefined)).toBeUndefined();
      expect(getCpuTimes('cpu 1 2 3\n')).toBeUndefined();
    });
  });

  describe('stealPercent', () => {
    const at = (user, system, idle, steal) => ({
      times: getCpuTimes(stat(user, system, idle, steal)),
    });

    it('is the share of the time between two snapshots that was steal', () => {
      expect(stealPercent(at(100, 0, 800, 0), at(300, 0, 1500, 100))).toBeCloseTo(10, 5); // 1000 units of time passed, 100 of them were steal
    });

    it('is 0 for a machine that was not held back', () => {
      expect(stealPercent(at(0, 0, 0, 0), at(100, 0, 100, 0))).toBe(0);
    });

    it('is not known when a snapshot has no times, or when no time passed', () => {
      expect(stealPercent({}, at(1, 1, 1, 1))).toBeUndefined();
      expect(stealPercent(at(1, 1, 1, 1), at(1, 1, 1, 1))).toBeUndefined();
    });
  });

  describe('report', () => {
    const snapshot = (steal) => ({
      cpuModel: 'Test CPU 9000',
      cores: 4,
      times: getCpuTimes(stat(0, 0, 0, steal)),
    });
    const later = (steal, total) => ({
      ...snapshot(steal),
      times: { total, steal },
    });

    it('shows the processor, the cores and the steal time', () => {
      const markdown = report(snapshot(0), later(2, 200));

      expect(markdown).toContain('| Processor | Test CPU 9000 |');
      expect(markdown).toContain('| Cores | 4 |');
      expect(markdown).toContain('| Steal time during the test | 1.0% |');
      expect(markdown).not.toContain('held back');
    });

    it('warns when a noticeable part of the time was steal', () => {
      expect(report(snapshot(0), later(30, 200))).toContain('held back by its host');
    });

    it('says n/a for the steal time when there is no second snapshot', () => {
      expect(report(snapshot(0), undefined)).toContain('| Steal time during the test | n/a |');
    });
  });

  describe('command line', () => {
    let folder;

    beforeAll(() => {
      folder = mkdtempSync(join(tmpdir(), 'runner-'));
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    const run = (...args) =>
      execFileSync('node', [resolve(__dirname, 'runner.js'), ...args], {
        encoding: 'utf8',
      });

    it('writes a snapshot from the files it is given and reports on two of them', () => {
      writeFileSync(join(folder, 'stat1'), stat(100, 0, 800, 0));
      writeFileSync(join(folder, 'stat2'), stat(300, 0, 1500, 100));
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
});
