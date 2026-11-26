import splitConfigurationLimits from './split-configuration-limits';
import { DEFAULT_MAX_CONNECTIONS } from '../constants';

describe('splitConfigurationLimits', () => {
  it('shares the limits of the workers and of the connections', () => {
    expect(splitConfigurationLimits({ workerLimit: 5, maxConnections: 101 }, { index: 0, count: 2 })).toEqual({ workerLimit: 3, maxConnections: 51 });
  });

  it('shares the default of the connections, and keeps the workers without a limit', () => {
    expect(splitConfigurationLimits({}, { index: 0, count: 2 })).toEqual({ workerLimit: 0, maxConnections: DEFAULT_MAX_CONNECTIONS / 2 });
  });
});
