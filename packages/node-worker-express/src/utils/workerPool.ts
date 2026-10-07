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
  private readonly cursors: Map<string, number>;

  constructor({ overallLimit = 0, idleCheckTimeout = 5, onExit = () => {} }: WorkerPoolParams) {
    this.overallLimit = overallLimit;
    this.idleCheckTimeout = idleCheckTimeout;
    this.onExit = onExit;
    this.workers = new Map();
    this.cursors = new Map();
    pools.push(this);
  }

  onClose = () => {
    this.workers.forEach((current) => current.forEach((worker) => worker.terminate()));
  };

  getWorkerCountForPath = (p) => {
    return this.workers.get(p)?.size ?? 0;
  };

  getWorkerCount = () => {
    return Array.from(this.workers.values()).reduce((result, current) => current.size + result, 0);
  };

  /** hands out the existing workers of a path in turns, so a single worker process does not become the bottleneck */
  private pickWorker = (workerPath: string): Worker => {
    const candidates = Array.from(this.workers.get(workerPath).values());
    const cursor = (this.cursors.get(workerPath) ?? 0) % candidates.length;
    this.cursors.set(workerPath, cursor + 1);

    return candidates[cursor];
  };

  private createWorker = (workerPath: string, options): Worker => {
    const id = uuid();
    const instance = new Worker(createWorkerCommand(workerPath), options);
    // every in-flight request listens for the messages of its worker, so more than the default 10 is expected
    instance.instance.setMaxListeners(0);
    const workersForPath = this.workers.get(workerPath) ?? new Map<string, Worker>();
    this.workers.set(workerPath, workersForPath);

    instance.addEventListenerOnce('close', (code: number) => {
      workersForPath.delete(id);
      this.onExit(code, workerPath, id);
    });

    workersForPath.set(id, instance);

    return instance;
  };

  /**
   * Returns a worker for the path, starting new ones until `limit` workers run for it, then rotating between them.
   * A limit of 0 (or less) keeps a single worker for the path.
   */
  getWorker = async (workerPath, options = {}, limit = 0): Promise<Worker> => {
    const belowPathLimit = this.getWorkerCountForPath(workerPath) < Math.max(limit, 1);
    const belowOverallLimit = this.overallLimit <= 0 || this.getWorkerCount() < this.overallLimit;

    if (belowPathLimit && belowOverallLimit) {
      return this.createWorker(workerPath, options);
    }

    if (this.getWorkerCountForPath(workerPath) > 0) {
      return this.pickWorker(workerPath);
    }

    await new Promise((r) => setTimeout(r, this.idleCheckTimeout));
    return this.getWorker(workerPath, options, limit);
  };
}

export default WorkerPool;
