import createMockLogger from './mock-logger.test-helper';
import reportProblems from './report-problems';
import type { ConfigurationProblem } from '../types';

const error: ConfigurationProblem = { severity: 'error', server: 's', setting: 'a', message: 'is wrong' };
const warning: ConfigurationProblem = { severity: 'warning', server: 's', setting: 'b', message: 'is odd' };

describe('reportProblems', () => {
  it('does nothing without problems', () => {
    const logger = createMockLogger();

    expect(() => reportProblems([], logger)).not.toThrow();
    expect(logger.warning).not.toHaveBeenCalled();
  });

  it('logs the warnings and goes on', () => {
    const logger = createMockLogger();

    reportProblems([warning], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('warning: s b is odd'));
  });

  it('throws with all of the problems when one is an error', () => {
    expect(() => reportProblems([error, warning], createMockLogger())).toThrow('The configuration has problems:\nerror: s a is wrong\nwarning: s b is odd');
  });
});
