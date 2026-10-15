interface Waiter<Request, Result> {
  request: Request;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface WaitingLineOptions<Request> {
  /** how long a request may wait, in milliseconds */
  acquireTimeout: number;
  /** how many requests may wait, 0 for no limit */
  maxQueue: number;
  /** the error of a request that finds the line full */
  createFullError: (request: Request, waiting: number) => Error;
  /** the error of a request that waited for as long as it may */
  createTimeoutError: (request: Request, acquireTimeout: number) => Error;
  /** the error of a request whose client went away while it waited */
  createAbandonedError: (request: Request) => Error;
}

/** requests that wait for something to become free, in the order of arrival, without polling: they are served when the owner wakes the line up */
class WaitingLine<Request, Result> {
  private readonly queue: Waiter<Request, Result>[] = [];
  private refused = { queueFull: 0, timedOut: 0 };
  private abandoned = 0;

  constructor(private readonly options: WaitingLineOptions<Request>) {}

  enqueue = (request: Request, signal?: AbortSignal) =>
    new Promise<Result>((resolve, reject) => {
      const { acquireTimeout, maxQueue, createFullError, createTimeoutError, createAbandonedError } = this.options;

      if (maxQueue > 0 && this.queue.length >= maxQueue) {
        this.refused.queueFull += 1;
        reject(createFullError(request, this.queue.length));
        return;
      }

      if (signal?.aborted) {
        this.abandoned += 1;
        reject(createAbandonedError(request));
        return;
      }

      const timer = setTimeout(() => {
        this.remove(waiter);
        this.refused.timedOut += 1;
        waiter.reject(createTimeoutError(request, acquireTimeout));
      }, acquireTimeout);
      const onAbort = () => {
        clearTimeout(timer);
        this.remove(waiter);
        this.abandoned += 1;
        reject(createAbandonedError(request));
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

  /** offers every waiting request to `serve`, the first one first: a request it gives a result for is served, one it gives nothing for keeps its place, one it throws for fails */
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

  private remove(waiter: Waiter<Request, Result>) {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
  }
}

export default WaitingLine;
