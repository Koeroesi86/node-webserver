import createLambdaStats from './create-lambda-stats';
import { defaultLambdaStats, getLambdaStats } from './get-lambda-stats';

describe('getLambdaStats', () => {
  it('reads the registry that middlewares without one of their own list themselves in', () => {
    const source = { lambdaPath: '/a.js', started: 1, starting: 0, count: 1, busy: 1, waiting: 0, abandoned: 0 };
    defaultLambdaStats.add(source);

    try {
      expect(getLambdaStats()).toMatchObject({ lambdas: 1, busy: 1, files: { '/a.js': { lambdas: 1, busy: 1 } } });
      expect(createLambdaStats().getStats().lambdas).toBe(0);
    } finally {
      defaultLambdaStats.remove(source);
    }
  });
});
