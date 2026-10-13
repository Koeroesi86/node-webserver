import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { Protocols, WORKER_EVENT } from '../constants';
import type { RequestEvent, WorkerOutputEvent } from '../types';
import serveRequest from './serve-request';
import type { WorkerLease } from './workerPool';

const event = { protocol: Protocols.http, path: '/a' } as unknown as RequestEvent;

const setup = ({ streamsBody = false, inlineBody }: { streamsBody?: boolean; inlineBody?: Buffer } = {}) => {
  const request = Object.assign(new EventEmitter(), {
    headers: {},
    httpVersionMajor: 1,
    socket: Object.assign(new EventEmitter(), { destroy: jest.fn() }),
    resume: jest.fn(),
    pause: jest.fn(),
  });
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableFinished: false,
    writeHead: jest.fn(),
    end: jest.fn(),
    write: jest.fn(),
    destroy: jest.fn(),
  });
  const subscription: { onMessage?: (message: WorkerOutputEvent) => void; onExit?: (code: number | null) => void } = {};
  const lease = {
    send: jest.fn(),
    release: jest.fn(),
    subscribe: jest.fn((_requestId: string, onMessage: (message: WorkerOutputEvent) => void, onExit: (code: number | null) => void) => {
      subscription.onMessage = onMessage;
      subscription.onExit = onExit;
    }),
  };
  const releaseSlot = jest.fn();

  serveRequest({
    request: request as unknown as Request,
    response: response as unknown as Response,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    event,
    inlineBody,
    streamsBody,
    releaseSlot,
    options: {},
  });

  return { request, response, lease, releaseSlot, subscription };
};

describe('serveRequest', () => {
  it('hands the request to the worker', () => {
    const { lease } = setup();

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event });
  });

  it('sends a body that arrived with the request along with it', () => {
    const { lease } = setup({ inlineBody: Buffer.from('abc') });

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event: { ...event, body: Buffer.from('abc') } });
  });

  it('forwards the parts of a streamed body and the end of it', () => {
    const { request, lease } = setup({ streamsBody: true });

    request.emit('data', Buffer.from('ab'));
    request.emit('end');

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r1', event: { body: Buffer.from('ab') } });
    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r1', event: { body: null } });
  });

  it('answers 502 when the worker exits, and gives the worker and the slot back', () => {
    const { response, lease, releaseSlot, subscription } = setup();

    subscription.onExit?.(1);

    expect(response.writeHead).toHaveBeenCalledWith(502, expect.objectContaining({ 'Content-Type': 'text/plain' }));
    expect(response.end).toHaveBeenCalledWith('Worker exited.');
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(releaseSlot).toHaveBeenCalledTimes(1);
  });

  it('drops the connection of a response that was already started when the worker exits', () => {
    const { response, subscription } = setup();
    response.headersSent = true;

    subscription.onExit?.(1);

    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(response.writeHead).not.toHaveBeenCalled();
  });

  it('gives the worker and the slot back when the response is done, and does not abort it', () => {
    const { response, lease, releaseSlot } = setup();
    response.writableFinished = true;

    response.emit('finish');

    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(releaseSlot).toHaveBeenCalledTimes(1);
    expect(lease.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
  });

  it('tells the worker to stop when the client goes away before the response is complete', () => {
    const { response, lease } = setup();

    response.emit('close');

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'r1' });
  });

  it('reads and drops what is left of a streamed body when the request is over', () => {
    const { request, response } = setup({ streamsBody: true });

    response.emit('close');

    expect(request.resume).toHaveBeenCalledTimes(1);
    expect(request.listenerCount('data')).toBe(0);
  });
});
