import decideChange from './decide-change';
import { createPlan } from './server-plan.test-helper';

describe('decideChange', () => {
  const decide = (next: Parameters<typeof createPlan>[0] = {}, extra: Partial<Parameters<typeof decideChange>[0]> = {}) =>
    decideChange({ running: createPlan(), next: createPlan(next), version: '1.0.0', force: false, ...extra });

  it('keeps the fronts when nothing changed', () => {
    expect(decide()).toEqual({ action: 'keep' });
  });

  it.each([
    ['the files of the configuration', { filesFingerprint: 'new' }],
    ['the number of fronts', { frontCount: 3 }],
  ])('starts new fronts for a change of %s', (_, change) => {
    expect(decide(change)).toEqual({ action: 'switch' });
  });

  it('starts new fronts without a change when it is told to', () => {
    expect(decide({}, { force: true })).toEqual({ action: 'switch' });
  });

  it('takes nothing of a configuration with an error, and takes one with a warning', () => {
    const problem = (severity: 'error' | 'warning') => ({ filesFingerprint: 'new', problems: [{ severity, setting: 'a', message: 'b' }] });

    expect([decide(problem('error')), decide(problem('warning'))]).toEqual([{ action: 'invalid' }, { action: 'switch' }]);
  });

  it.each([
    ['another version of the server', { release: { configuration: 'a', version: '2.0.0' } }, {}, '2.0.0 now, instead of 1.0.0'],
    ['one front where there were several', { filesFingerprint: 'new', balanced: false }, {}, 'between one front and several'],
  ])('restarts for %s', (_, change, extra, reason) => {
    expect(decide(change, extra)).toEqual({ action: 'restart', reason: expect.stringContaining(reason) });
  });
});
