import WorkerAbandonedError from './workerAbandonedError';
import WorkerBusyError from './workerBusyError';
import WorkerAcquisitionQueue from './worker-acquisition-queue';

interface Request {
  workerPath: string;
  id: string;
}

const request = (id: string): Request => ({ workerPath: `/workers/${id}.js`, id });

describe('WorkerAcquisitionQueue', () => {
  it('serves requests in order and keeps unserved requests waiting', async () => {
    const queue = new WorkerAcquisitionQueue<Request, string>(1000, 0);
    const first = queue.enqueue(request('first'));
    const second = queue.enqueue(request('second'));
    const served: string[] = [];

    queue.wakeUp(({ id }) => {
      if (id === 'first') return undefined;
      served.push(id);
      return id;
    });

    await expect(second).resolves.toBe('second');
    expect(queue.getStats().waiting).toBe(1);

    queue.wakeUp(({ id }) => {
      served.push(id);
      return id;
    });

    await expect(first).resolves.toBe('first');
    expect(served).toEqual(['second', 'first']);
    expect(queue.getStats().waiting).toBe(0);
  });

  it('counts full queues and aborted requests without disturbing waiting requests', async () => {
    const queue = new WorkerAcquisitionQueue<Request, string>(1000, 1);
    const aborted = new AbortController();
    aborted.abort();

    await expect(queue.enqueue(request('aborted'), aborted.signal)).rejects.toBeInstanceOf(WorkerAbandonedError);
    const waiting = queue.enqueue(request('waiting'));
    await expect(queue.enqueue(request('full'))).rejects.toBeInstanceOf(WorkerBusyError);
    expect(queue.getStats()).toEqual({ waiting: 1, refused: { queueFull: 1, timedOut: 0 }, abandoned: 1 });

    queue.wakeUp(({ id }) => id);
    await expect(waiting).resolves.toBe('waiting');
  });

  it('removes timed-out requests and counts the refusal', async () => {
    jest.useFakeTimers();
    try {
      const queue = new WorkerAcquisitionQueue<Request, string>(50, 0);
      const waiting = queue.enqueue(request('timed-out'));

      jest.advanceTimersByTime(50);

      await expect(waiting).rejects.toBeInstanceOf(WorkerBusyError);
      expect(queue.getStats()).toEqual({ waiting: 0, refused: { queueFull: 0, timedOut: 1 }, abandoned: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
});
