import { Protocols, WORKER_EVENT, type RequestEvent, type WorkerLease, type WorkerOutputEvent } from '@koeroesi86/node-worker/pool';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import serveRequest from './serve-request';

const mockWebSocket = { receive: jest.fn(), dispose: jest.fn() };
jest.mock('./create-ws-connection', () => ({ __esModule: true, default: jest.fn(() => mockWebSocket) }));

/** the hand-offs of the request under test, to make them active */
const mockHandOffs: Array<{ isActive: () => boolean }> = [];
jest.mock('./create-response-hand-off', () => {
  const actual = jest.requireActual('./create-response-hand-off').default;
  return {
    __esModule: true,
    default: (...args: unknown[]) => {
      const handOff = actual(...args);
      mockHandOffs.push(handOff);
      return handOff;
    },
  };
});

const httpEvent = { protocol: Protocols.http, path: '/a' } as unknown as RequestEvent;
const socketEvent = { protocol: Protocols.websocket, path: '/a' } as unknown as RequestEvent;

const setup = ({ streamsBody = false, inlineBody, event = httpEvent }: { streamsBody?: boolean; inlineBody?: Buffer; event?: RequestEvent } = {}) => {
  mockHandOffs.length = 0;
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

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event: httpEvent });
  });

  it('sends a body that arrived with the request along with it', () => {
    const { lease } = setup({ inlineBody: Buffer.from('abc') });

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event: { ...httpEvent, body: Buffer.from('abc') } });
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

  it('leaves no listener on the request and the response once it is over', () => {
    const { request, response } = setup({ streamsBody: true });

    response.emit('close');

    expect(request.listenerCount('aborted')).toBe(0);
    expect(request.listenerCount('end')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('keeps the listeners and the worker while the connection is handed over, and gives them back when it is over', () => {
    const { request, response, lease, releaseSlot } = setup();
    const isActive = jest.spyOn(mockHandOffs[0], 'isActive').mockReturnValue(true);

    response.emit('close');

    expect(lease.release).not.toHaveBeenCalled();
    expect(releaseSlot).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(1);
    expect(response.listenerCount('close')).toBe(1);

    isActive.mockReturnValue(false);
    response.emit('close');

    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  describe('of a websocket', () => {
    it('tells the worker and gives it back when the client closes, and leaves no listener on the socket', () => {
      const { request, lease, releaseSlot } = setup({ event: socketEvent });

      request.socket.emit('close');

      expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_CONNECTION_CLOSE, requestId: 'r1', event: socketEvent });
      expect(lease.release).toHaveBeenCalledTimes(1);
      expect(releaseSlot).toHaveBeenCalledTimes(1);
      expect(mockWebSocket.dispose).toHaveBeenCalledTimes(1);
      expect(request.socket.listenerCount('data')).toBe(0);
      expect(request.socket.listenerCount('close')).toBe(0);
    });

    it('destroys the socket when the worker exits', () => {
      const { request, subscription } = setup({ event: socketEvent });

      subscription.onExit?.(1);

      expect(request.socket.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
