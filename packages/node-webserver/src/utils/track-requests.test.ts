import { EventEmitter } from 'events';
import trackRequests from './track-requests';
import type { Request, Response } from 'express';

describe('trackRequests', () => {
  const response = () => new EventEmitter() as unknown as Response;
  const request = {} as Request;

  it('is idle without requests', async () => {
    await expect(trackRequests(jest.fn()).idle()).resolves.toBeUndefined();
  });

  it('passes the requests on', () => {
    const handler = jest.fn();
    const next = jest.fn();
    const res = response();

    trackRequests(handler).handler(request, res, next);

    expect(handler).toHaveBeenCalledWith(request, res, next);
  });

  it('is idle once every request it took is answered', async () => {
    const tracked = trackRequests(jest.fn());
    const first = response();
    const second = response();
    tracked.handler(request, first, jest.fn());
    tracked.handler(request, second, jest.fn());
    const idle = jest.fn();

    tracked.idle().then(idle);
    first.emit('close');
    await Promise.resolve();
    expect(idle).not.toHaveBeenCalled();
    second.emit('close');
    await Promise.resolve();

    expect(idle).toHaveBeenCalled();
  });
});
