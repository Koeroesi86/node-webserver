import type { WorkerPool } from '@koeroesi86/node-worker/pool';
import createLambdaStatsSource from './create-lambda-stats-source';

const poolWith = (stats: Partial<ReturnType<WorkerPool['getCounts']>>) =>
  ({ getCounts: () => ({ workers: 0, starting: 0, active: 0, waiting: 0, abandoned: 0, ...stats }) }) as unknown as WorkerPool;

describe('createLambdaStatsSource', () => {
  it('counts the workers of the pool as lambdas, the ones that are ready as started', () => {
    const source = createLambdaStatsSource('/lambdas/a.js', poolWith({ workers: 3, starting: 1 }));

    expect([source.lambdaPath, source.count, source.started, source.starting]).toEqual(['/lambdas/a.js', 3, 2, 1]);
  });

  it('counts the lambdas that run a request as busy, but not the ones that only start for one', () => {
    expect(createLambdaStatsSource('/a.js', poolWith({ workers: 3, starting: 1, active: 3 })).busy).toBe(2);
    expect(createLambdaStatsSource('/a.js', poolWith({ workers: 1, starting: 1, active: 0 })).busy).toBe(0);
  });

  it('reads the line of the pool', () => {
    const source = createLambdaStatsSource('/a.js', poolWith({ waiting: 4, abandoned: 2 }));

    expect([source.waiting, source.abandoned]).toEqual([4, 2]);
  });

  it('reads the pool every time it is asked', () => {
    const stats = { workers: 1 };
    const source = createLambdaStatsSource('/a.js', { getCounts: () => stats } as unknown as WorkerPool);

    stats.workers = 5;

    expect(source.count).toBe(5);
  });
});
