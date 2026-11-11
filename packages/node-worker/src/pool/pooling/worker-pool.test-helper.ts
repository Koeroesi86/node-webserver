import WorkerPool from './worker-pool';
import type { WorkerLease } from './worker-pool';

export const pathA = '/root/a/exampleWorker.js';
export const pathB = '/root/b/exampleWorker.js';

export const createPool = (params = {}) => new WorkerPool({ acquireTimeout: 50, ...params });
export const acquireAllWith = (pool: WorkerPool, workerPath: string, options: () => object, limit: number, count: number) =>
  Array.from({ length: count }).reduce<Promise<WorkerLease[]>>(
    async (leases, _) => [...(await leases), await pool.acquire(workerPath, options, limit)],
    Promise.resolve([])
  );
export const acquireAll = (pool: WorkerPool, workerPath: string, limit: number, count: number) =>
  Array.from({ length: count }).reduce<Promise<WorkerLease[]>>(
    async (leases, _) => [...(await leases), await pool.acquire(workerPath, {}, limit)],
    Promise.resolve([])
  );
