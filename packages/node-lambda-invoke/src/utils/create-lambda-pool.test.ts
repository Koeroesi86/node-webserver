import { existsSync } from 'fs';
import { basename } from 'path';
import type { WorkerPoolParams } from '@koeroesi86/node-worker-pool';
import createLambdaPool from './create-lambda-pool';

jest.mock('@koeroesi86/node-worker-pool', () => {
  class FakePool {
    static last: { params: WorkerPoolParams };
    constructor(readonly params: WorkerPoolParams) {
      FakePool.last = this;
    }
  }

  return { WorkerPool: FakePool, createWorkerBudget: jest.fn(() => ({ budget: true })) };
});

const FakePool = jest.requireMock('@koeroesi86/node-worker-pool').WorkerPool;

const create = (fields: Partial<Parameters<typeof createLambdaPool>[0]> = {}) => {
  const logger = jest.fn();
  createLambdaPool({
    lambdaPath: '/lambdas/api.js',
    handlerKey: 'main',
    limit: 3,
    acquireTimeout: 500,
    startTimeout: 2000,
    timeout: 30000,
    restrictFileSystem: true,
    logger,
    ...fields,
  });

  return { params: FakePool.last.params as Required<WorkerPoolParams>, logger };
};

describe('createLambdaPool', () => {
  it('makes a pool of lambdas that take one request at a time, under the limit and the timeouts it is given', () => {
    const { params } = create();

    expect(params).toMatchObject({ overallLimit: 3, acquireTimeout: 500, startTimeout: 2000, concurrency: 1, maxQueue: 0 });
  });

  it('drains a lambda after a while, asks it to stop with SIGTERM and kills it when it does not', () => {
    const { params } = create();

    expect(params).toMatchObject({ maxAge: 14.5 * 60 * 1000, stopSignal: 'SIGTERM', killAfter: 5000 });
  });

  it('runs the file of the lambda in the runner, with node that runs the server', () => {
    const { params } = create();
    const [executable, runner, lambdaPath] = params.createCommand('/lambdas/api.js');

    expect([executable, basename(runner), lambdaPath]).toEqual([process.execPath, 'runner.js', '/lambdas/api.js']);
  });

  it('shares a budget without a limit between the pools, so that none limits another', () => {
    create();
    create();

    expect(jest.requireMock('@koeroesi86/node-worker-pool').createWorkerBudget).toHaveBeenCalledTimes(1);
    expect(FakePool.last.params.budget).toEqual({ budget: true });
  });

  it('logs what a lambda writes and the exit code of one that failed, not of one that ended well', () => {
    const { params, logger } = create();

    params.onStdout(Buffer.from(' hello \n'));
    params.onStderr(Buffer.from('oops'));
    params.onExit(1, '/lambdas/api.js', 'id');
    params.onExit(0, '/lambdas/api.js', 'id');

    expect(logger.mock.calls.map(([line]) => line.replace(/^\[[^\]]+\] /, ''))).toEqual(['hello', 'oops', 'child process exited with code 1']);
  });

  describe('a lambda that is prepared', () => {
    const prepare = (fields = {}) => create(fields).params.prepareWorker({ workerPath: '/lambdas/api.js', id: 'id' });

    it('gets a folder of its own for temporary files that goes with it, and only the environment it is allowed to have', () => {
      const prepared = prepare({ env: { TABLE: 'users' } });
      const env = (prepared.options as { env: Record<string, string> }).env;

      try {
        expect(existsSync(env.TMPDIR)).toBe(true);
        expect(basename(env.TMPDIR)).toBe('tmp');
        expect(env).toMatchObject({ TABLE: 'users', NODE_LAMBDA_PATH: '/lambdas/api.js', NODE_LAMBDA_HANDLER: 'main', _HANDLER: 'api.main' });
      } finally {
        prepared.onClose?.();
      }
    });

    it('removes the folder when it ended', async () => {
      const prepared = prepare();
      const { TMPDIR } = (prepared.options as { env: Record<string, string> }).env;

      prepared.onClose?.();

      for (let waited = 0; existsSync(TMPDIR) && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(existsSync(TMPDIR)).toBe(false);
    });

    it('can only write to its folder when the file system is restricted, anywhere otherwise', () => {
      const restricted = prepare();
      const open = prepare({ restrictFileSystem: false });

      try {
        expect((open.options as { execArgv: string[] }).execArgv).toEqual([]);
        // the flags of the permission model need a node that has it
        expect((restricted.options as { execArgv: string[] }).execArgv.some((flag) => flag.startsWith('--allow-fs-write='))).toBe(
          process.allowedNodeEnvironmentFlags.has('--permission')
        );
      } finally {
        restricted.onClose?.();
        open.onClose?.();
      }
    });
  });
});
