import createLambdaStats from './create-lambda-stats';
import type { LambdaStatsSource } from '../types';

const pool = (lambdaPath: string, counts: Partial<LambdaStatsSource> = {}): LambdaStatsSource => ({
  lambdaPath,
  started: 1,
  starting: 0,
  count: 1,
  busy: 0,
  waiting: 0,
  abandoned: 0,
  ...counts,
});

describe('createLambdaStats', () => {
  it('adds up the pools in it, and the pools of one file', () => {
    const stats = createLambdaStats();
    stats.add(pool('/a.js', { busy: 1, waiting: 2 }));
    stats.add(pool('/a.js', { starting: 1, abandoned: 3 }));

    expect(stats.getStats()).toEqual({ lambdas: 2, starting: 1, busy: 1, waiting: 2, abandoned: 3, files: { '/a.js': { lambdas: 2, busy: 1 } } });
  });

  it('stops counting a pool that was removed', () => {
    const stats = createLambdaStats();
    const removed = pool('/gone.js');
    stats.add(removed);
    stats.add(pool('/kept.js'));
    stats.remove(removed);

    expect(stats.getStats().files).toEqual({ '/kept.js': { lambdas: 1, busy: 0 } });
  });

  it('does not share its pools with another registry', () => {
    const [first, second] = [createLambdaStats(), createLambdaStats()];
    first.add(pool('/a.js'));

    expect(second.getStats().lambdas).toBe(0);
  });
});
