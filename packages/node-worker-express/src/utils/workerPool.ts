import { v4 as uuid } from 'uuid';
import path from 'path';
import Worker from '@koeroesi86/node-worker';

const pools: WorkerPool[] = [];

process.once('exit', () => {
  pools.forEach((pool) => pool.onClose());
});

const createWorkerCommand = (workerPath) => {
  const ext = path.extname(workerPath);
  switch (ext) {
    case '.js':
    default:
      return `node --expose-gc ${path.resolve(__dirname, './workerInvoke.js')} ${workerPath}`;
  }
};

interface WorkerPoolParams {
  overallLimit?: number;
  idleCheckTimeout?: number;
  onExit?: (code: number, workerPath: string, id: string) => void;
}

class WorkerPool {
  protected readonly overallLimit: number;
  protected readonly idleCheckTimeout: number;
  protected readonly onExit: (code: number, workerPath: string, id: string) => void;
  protected readonly workers: Map<string, Map<string, Worker>>;
  private creating: boolean;

  constructor({ overallLimit = 0, idleCheckTimeout = 5, onExit = () => {} }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.idleCheckTimeout = idleCheckTimeout;
    this.onExit = onExit;
    this.workers = new Map();
    pools.push(this);

    this.creating = false;
  }

  onClose = () => {
    this.workers.forEach((current) => current.forEach((worker) => worker.terminate()));
  };

  getNonBusyId = (workerPath) => {
    // the first worker is always picked, busy tracking is disabled
    return this.workers.get(workerPath)?.keys().next().value;
  };

  getWorkerCountForPath = (p) => {
    return this.workers.get(p)?.size ?? 0;
  };

  getWorkerCount = () => {
    return Array.from(this.workers.values()).reduce((result, current) => current.size + result, 0);
  };

  isBeyondLimit = (workerPath, limit) => {
    return (
      (this.workers.has(workerPath) && limit > 0 && this.getWorkerCountForPath(workerPath) >= limit) ||
      (this.overallLimit > 0 && this.getWorkerCount() >= this.overallLimit)
    );
  };

  getWorker = async (workerPath, options = {}, limit = 0): Promise<Worker> => {
    const nonBusyId = this.getNonBusyId(workerPath);
    // TODO: tidy up
    if (nonBusyId !== undefined) {
      return this.workers.get(workerPath).get(nonBusyId);
    } else if (this.isBeyondLimit(workerPath, limit) || this.creating) {
      await new Promise((r) => setTimeout(r, this.idleCheckTimeout));
      return this.getWorker(workerPath, options, limit);
    }

    this.creating = true;

    try {
      const id = uuid();
      const instance = new Worker(createWorkerCommand(workerPath), options);

      const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
      this.workers.set(workerPath, workersForPath);

      instance.addEventListenerOnce('close', (code: number) => {
        workersForPath.delete(id);
        this.onExit(code, workerPath, id);
      });

      workersForPath.set(id, instance);

      return instance;
    } finally {
      // a failed spawn must not leave the pool waiting for a worker that never gets created
      this.creating = false;
    }
  };
}

export default WorkerPool;
