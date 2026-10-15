import WaitingLine from './waiting-line';

class FullError extends Error {}
class TimeoutError extends Error {}
class AbandonedError extends Error {}

const create = (acquireTimeout: number, maxQueue = 0) =>
  new WaitingLine<string, string>({
    acquireTimeout,
    maxQueue,
    createFullError: (request, waiting) => new FullError(`${waiting} wait, ${request} refused`),
    createTimeoutError: (request, timeout) => new TimeoutError(`${request} waited ${timeout}ms`),
    createAbandonedError: (request) => new AbandonedError(request),
  });

describe('WaitingLine', () => {
  it('serves requests in order and keeps unserved requests waiting', async () => {
    const line = create(1000);
    const first = line.enqueue('first');
    const second = line.enqueue('second');
    const served: string[] = [];

    line.wakeUp((request) => {
      if (request === 'first') return undefined;
      served.push(request);
      return request;
    });

    await expect(second).resolves.toBe('second');
    expect(line.getStats().waiting).toBe(1);

    line.wakeUp((request) => {
      served.push(request);
      return request;
    });

    await expect(first).resolves.toBe('first');
    expect(served).toEqual(['second', 'first']);
    expect(line.getStats().waiting).toBe(0);
  });

  it('fails a request that the serving function throws for, and goes on with the others', async () => {
    const line = create(1000);
    const failing = line.enqueue('failing');
    const next = line.enqueue('next');

    line.wakeUp((request) => {
      if (request === 'failing') throw new Error('no way');
      return request;
    });

    await expect(failing).rejects.toThrow('no way');
    await expect(next).resolves.toBe('next');
  });

  it('counts full lines and aborted requests without disturbing waiting requests', async () => {
    const line = create(1000, 1);
    const aborted = new AbortController();
    aborted.abort();

    await expect(line.enqueue('aborted', aborted.signal)).rejects.toBeInstanceOf(AbandonedError);
    const waiting = line.enqueue('waiting');
    await expect(line.enqueue('full')).rejects.toThrow('1 wait, full refused');
    expect(line.getStats()).toEqual({ waiting: 1, refused: { queueFull: 1, timedOut: 0 }, abandoned: 1 });

    line.wakeUp((request) => request);
    await expect(waiting).resolves.toBe('waiting');
  });

  it('takes a request out of the line when its signal is aborted later', async () => {
    const line = create(1000);
    const leaving = new AbortController();
    const abandoned = line.enqueue('leaving', leaving.signal);
    const serve = jest.fn((request: string) => request);

    leaving.abort();

    await expect(abandoned).rejects.toBeInstanceOf(AbandonedError);
    line.wakeUp(serve);
    expect(serve).not.toHaveBeenCalled();
    expect(line.getStats()).toEqual({ waiting: 0, refused: { queueFull: 0, timedOut: 0 }, abandoned: 1 });
  });

  it('removes timed-out requests and counts the refusal', async () => {
    jest.useFakeTimers();
    try {
      const line = create(50);
      const waiting = line.enqueue('timed-out');

      jest.advanceTimersByTime(50);

      await expect(waiting).rejects.toThrow('timed-out waited 50ms');
      expect(line.getStats()).toEqual({ waiting: 0, refused: { queueFull: 0, timedOut: 1 }, abandoned: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
});
