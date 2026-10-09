import type { Request, Response } from 'express';
import { WebSocketCloseCode, WORKER_EVENT } from '../constants';
import type { WorkerOutputEvent } from '../types';
import createResponseHandOff from './create-response-hand-off';
import createWorkerMessageListener from './create-worker-message-listener';
import type createWsConnection from './create-ws-connection';
import type { WorkerLease } from './workerPool';

const setup = ({ withWebSocket = false, headersSent = false } = {}) => {
  const request = { socket: { setTimeout: jest.fn() } };
  const finishListeners: Array<() => void> = [];
  const response = {
    headersSent,
    writeHead: jest.fn(),
    write: jest.fn((_body: unknown, callback?: () => void) => callback?.()),
    end: jest.fn(),
    once: jest.fn((_event: string, listener: () => void) => finishListeners.push(listener)),
  };
  const lease = { send: jest.fn() };
  const webSocket = { open: jest.fn(), send: jest.fn(), close: jest.fn(), acknowledge: jest.fn() };
  const handOff = { isActive: jest.fn(() => false), start: jest.fn(), finish: jest.fn(), reset: jest.fn() };
  const callbacks = { armResponseTimeout: jest.fn(), onBodyPartTaken: jest.fn(), cleanup: jest.fn() };
  const listener = createWorkerMessageListener({
    request: request as unknown as Request,
    response: response as unknown as Response,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    webSocket: withWebSocket ? (webSocket as unknown as ReturnType<typeof createWsConnection>) : undefined,
    handOff: handOff as unknown as ReturnType<typeof createResponseHandOff>,
    ...callbacks,
  });

  return { request, response, lease, webSocket, handOff, callbacks, listener, finishListeners };
};

const respond = (statusCode: number, extra: { headers?: Record<string, string>; body?: Buffer } = {}): WorkerOutputEvent => ({
  type: WORKER_EVENT.RESPONSE,
  requestId: 'r1',
  event: { statusCode, ...extra },
});

describe('createWorkerMessageListener', () => {
  it('arms the response timeout for every message', () => {
    const { listener, callbacks } = setup();

    listener(respond(200));

    expect(callbacks.armResponseTimeout).toHaveBeenCalledTimes(1);
  });

  it('answers with the metrics of the server when the worker asks for them', () => {
    const { listener, lease } = setup();

    listener({ type: WORKER_EVENT.METRICS_REQUEST, requestId: 'r1' });

    expect(lease.send).toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.METRICS, requestId: 'r1', event: expect.any(Object) }));
  });

  it('tells the body forwarder that the worker took a part of the body', () => {
    const { listener, callbacks } = setup();

    listener({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId: 'r1' });

    expect(callbacks.onBodyPartTaken).toHaveBeenCalledTimes(1);
  });

  describe('a response', () => {
    it('is written with the length of its body when the worker did not say how long it is', () => {
      const { listener, response } = setup();

      listener(respond(200, { headers: { 'x-a': 'b' }, body: Buffer.from('hello') }));

      expect(response.writeHead).toHaveBeenCalledWith(200, { 'x-a': 'b', 'Content-Length': 5 });
      expect(response.write).toHaveBeenCalledWith(Buffer.from('hello'));
      expect(response.end).toHaveBeenCalledTimes(1);
    });

    it('keeps the headers of a worker that sets the length itself', () => {
      const { listener, response } = setup();

      listener(respond(200, { headers: { 'Content-Length': '2' }, body: Buffer.from('ok') }));

      expect(response.writeHead).toHaveBeenCalledWith(200, { 'Content-Length': '2' });
    });

    it('is not acknowledged, the worker does not wait for it', () => {
      const { listener, lease } = setup();

      listener(respond(204));

      expect(lease.send).not.toHaveBeenCalled();
    });

    it('opens the websocket on the answer of an upgrade and stops the idle timeout of the socket once it is done', () => {
      const { listener, webSocket, request, finishListeners } = setup({ withWebSocket: true });

      listener(respond(101));
      finishListeners.forEach((listenerOfFinish) => listenerOfFinish());

      expect(webSocket.open).toHaveBeenCalledTimes(1);
      expect(request.socket.setTimeout).toHaveBeenCalledWith(0);
    });

    it('frees the worker when an upgrade is refused', () => {
      const { listener, webSocket, callbacks } = setup({ withWebSocket: true });

      listener(respond(403));

      expect(webSocket.open).not.toHaveBeenCalled();
      expect(callbacks.cleanup).toHaveBeenCalledTimes(1);
    });

    it('is ignored once the upgrade was answered', () => {
      const { listener, response } = setup({ withWebSocket: true, headersSent: true });

      listener(respond(200));

      expect(response.writeHead).not.toHaveBeenCalled();
    });
  });

  describe('a streamed response', () => {
    it('writes the head once, acknowledges every part when it was written and arms the timeout again', () => {
      const { listener, response, lease, callbacks } = setup();

      listener({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r1', event: { statusCode: 200, headers: { a: 'b' }, body: Buffer.from('part') } });

      expect(response.writeHead).toHaveBeenCalledWith(200, { a: 'b' });
      expect(response.write).toHaveBeenCalledWith(Buffer.from('part'), expect.any(Function));
      expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r1' });
      expect(callbacks.armResponseTimeout).toHaveBeenCalledTimes(2);
    });

    it('does not write the head again once it was sent', () => {
      const { listener, response } = setup({ headersSent: true });

      listener({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r1', event: { statusCode: 200, body: Buffer.from('more') } });

      expect(response.writeHead).not.toHaveBeenCalled();
    });

    it('ends on a part of null and acknowledges it', () => {
      const { listener, response, lease } = setup({ headersSent: true });

      listener({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r1', event: { statusCode: 200, body: null } });

      expect(response.end).toHaveBeenCalledTimes(1);
      expect(response.write).not.toHaveBeenCalled();
      expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r1' });
    });
  });

  describe('a response whose connection went to the worker', () => {
    const head = { statusCode: 200, headers: { 'Content-Length': '5' } };

    it('gives the connection to the worker when it asks for it', () => {
      const { listener, handOff } = setup();

      listener({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'r1', event: head });

      expect(handOff.start).toHaveBeenCalledWith(head);
    });

    it('acknowledges the end of the body the worker wrote, frees the worker and does not write to the client', () => {
      const { listener, handOff, lease, response, callbacks } = setup();
      handOff.isActive.mockReturnValue(true);

      listener({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r1', event: { statusCode: 200, body: null } });

      expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r1' });
      expect(handOff.finish).toHaveBeenCalledTimes(1);
      expect(callbacks.cleanup).toHaveBeenCalledTimes(1);
      expect(response.end).not.toHaveBeenCalled();
    });

    it('ignores a part of the body while the worker writes it itself', () => {
      const { listener, handOff, response, callbacks } = setup();
      handOff.isActive.mockReturnValue(true);

      listener({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r1', event: { statusCode: 200, body: Buffer.from('x') } });

      expect(response.write).not.toHaveBeenCalled();
      expect(callbacks.cleanup).not.toHaveBeenCalled();
    });
  });

  describe('the messages of a websocket', () => {
    it('passes the acknowledgement of a received message to the connection', () => {
      const { listener, webSocket } = setup({ withWebSocket: true });

      listener({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId: 'r1' });

      expect(webSocket.acknowledge).toHaveBeenCalledTimes(1);
    });

    it('sends a message to the client and acknowledges it once it was written', () => {
      const { listener, webSocket, lease } = setup({ withWebSocket: true });
      webSocket.send.mockImplementation((_body: unknown, written: (done: boolean) => void) => written(true));

      listener({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r1', event: { body: 'hi' } });

      expect(webSocket.send).toHaveBeenCalledWith('hi', expect.any(Function));
      expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r1' });
    });

    it('does not acknowledge a message that was not written', () => {
      const { listener, webSocket, lease } = setup({ withWebSocket: true });
      webSocket.send.mockImplementation((_body: unknown, written: (done: boolean) => void) => written(false));

      listener({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r1', event: { body: 'hi' } });

      expect(lease.send).not.toHaveBeenCalled();
    });

    it('closes the connection with the code of the worker, or a normal close without one', () => {
      const { listener, webSocket } = setup({ withWebSocket: true });

      listener({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r1', event: { close: { code: 1008, reason: 'no' } } });
      listener({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r1', event: { close: {} } });

      expect(webSocket.close).toHaveBeenNthCalledWith(1, 1008, 'no');
      expect(webSocket.close).toHaveBeenNthCalledWith(2, WebSocketCloseCode.normal, undefined);
    });
  });
});
