import WorkerAbandonedError from './workerAbandonedError';
import WorkerBusyError from './workerBusyError';

interface QueuedRequest {
  workerPath: string;
}

interface Waiter<Request, Result> {
  request: Request;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

class WorkerAcquisitionQueue<Request extends QueuedRequest, Result> {
  private readonly queue: Waiter<Request, Result>[] = [];
  private refused = { queueFull: 0, timedOut: 0 };
  private abandoned = 0;

  constructor(
    private readonly acquireTimeout: number,
    private readonly maxQueue: number
  ) {}

  enqueue = (request: Request, signal?: AbortSignal) =>
    new Promise<Result>((resolve, reject) => {
      if (this.maxQueue > 0 && this.queue.length >= this.maxQueue) {
        this.refused.queueFull += 1;
        reject(new WorkerBusyError(request.workerPath, `${this.queue.length} requests wait for a worker for ${request.workerPath} already.`));
        return;
      }

      if (signal?.aborted) {
        this.abandoned += 1;
        reject(new WorkerAbandonedError(request.workerPath));
        return;
      }

      const timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        this.refused.timedOut += 1;
        waiter.reject(new WorkerBusyError(request.workerPath, `No worker became available for ${request.workerPath} within ${this.acquireTimeout}ms.`));
      }, this.acquireTimeout);
      const onAbort = () => {
        clearTimeout(timer);
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        this.abandoned += 1;
        reject(new WorkerAbandonedError(request.workerPath));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle =
        <Value>(settleWaiter: (value: Value) => void) =>
        (value: Value) => {
          signal?.removeEventListener('abort', onAbort);
          settleWaiter(value);
        };
      const waiter: Waiter<Request, Result> = { request, resolve: settle(resolve), reject: settle(reject), timer };
      this.queue.push(waiter);
    });

  wakeUp = (serve: (request: Request) => Result | undefined) => {
    this.queue.splice(0).forEach((waiter) => {
      try {
        const result = serve(waiter.request);
        if (result === undefined) {
          this.queue.push(waiter);
          return;
        }
        clearTimeout(waiter.timer);
        waiter.resolve(result);
      } catch (error) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  };

  getStats = () => ({
    waiting: this.queue.length,
    refused: { ...this.refused },
    abandoned: this.abandoned,
  });
}

export default WorkerAcquisitionQueue;
