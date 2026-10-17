import net from 'net';
import { duplexPair } from 'stream';
import { Protocols, WORKER_EVENT } from '../constants';
import createChannel from './createChannel';
import createWorkerSession from './create-worker-session';
import { createSocketPair, readUntilClosed } from './socket-pair.test-helper';
import type { HandBackMessage, InvokableWorker, RequestHandBackMessage, RequestMessage, WorkerInputEvent, WorkerOutputEvent } from '../types';

const request: RequestMessage = {
  httpMethod: 'GET',
  protocol: Protocols.http,
  path: '/',
  pathFragments: [],
  queryStringParameters: {},
  headers: {},
  remoteAddress: '127.0.0.1',
  rootPath: '/',
};
const reply = { statusCode: 200, headers: {}, body: 'ok', isBase64Encoded: false };
const until = async (condition: () => boolean) => {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
};

/** the session over two in-memory duplex streams, the other end of which stands for the server */
const setup = (worker: InvokableWorker, sendHandBack?: Parameters<typeof createWorkerSession>[2]) => {
  const [workerSide, serverSide] = duplexPair();
  const received: WorkerOutputEvent[] = [];
  const server = createChannel<WorkerOutputEvent, WorkerInputEvent>(serverSide, (message) => received.push(message));
  const session = createWorkerSession(worker, workerSide, sendHandBack);
  const types = () => received.map(({ type }) => type);

  return { server, session, received, types, close: () => [workerSide, serverSide].forEach((side) => side.destroy()) };
};

describe('createWorkerSession', () => {
  it('answers a request with what the worker responds', async () => {
    const { server, received, types, close } = setup(async (_event, callback) => {
      callback(reply);
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
    await until(() => received.length > 0);

    expect(types()).toEqual([WORKER_EVENT.RESPONSE]);
    expect(received[0]).toMatchObject({ requestId: 'r', event: { statusCode: 200, body: Buffer.from('ok') } });
    close();
  });

  it('answers 500 when the worker throws before it answered, and logs the error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { server, received, close } = setup(() => {
      throw new Error('fails');
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
    await until(() => received.length > 0);

    expect(received[0]).toMatchObject({ type: WORKER_EVENT.RESPONSE, event: { statusCode: 500 } });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    close();
  });

  it('streams a response in parts that wait for the acknowledgement, and leaves nothing behind', async () => {
    const results: boolean[] = [];
    const { server, session, received, close } = setup(async (_event, callback) => {
      results.push(Boolean(await callback({ ...reply, emit: true })));
      results.push(Boolean(await callback({ ...reply, body: null, emit: true })));
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
    await until(() => received.length === 1);
    expect(results).toEqual([]);
    server.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r' });
    await until(() => received.length === 2);
    server.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'r' });
    await until(() => results.length === 2);

    expect(received.map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE_EMIT, WORKER_EVENT.RESPONSE_EMIT]);
    expect(results).toEqual([true, true]);
    expect(session.contexts.size).toBe(0);
    close();
  });

  it('resolves what a streaming worker waits for with false when the request is aborted', async () => {
    let result: unknown;
    const { server, session, received, close } = setup(async (_event, callback) => {
      result = await callback({ ...reply, emit: true });
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
    await until(() => received.length === 1);
    server.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'r' });
    await until(() => result !== undefined);

    expect(result).toBe(false);
    close();
  });

  it('gives the worker a streamed request body and acknowledges the parts', async () => {
    let body = '';
    const { server, received, close } = setup(async ({ bodyStream }, callback) => {
      for await (const chunk of bodyStream) body += chunk;
      callback(reply);
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: { ...request, hasBody: true } });
    server.send({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r', event: { body: Buffer.from('ab') } });
    server.send({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r', event: { body: null } });
    await until(() => received.some(({ type }) => type === WORKER_EVENT.RESPONSE));

    expect(body).toBe('ab');
    expect(received.map(({ type }) => type)).toContain(WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE);
    close();
  });

  it('answers a worker that asks for the metrics with what the server sends', async () => {
    const { server, received, close } = setup(async ({ getMetrics }, callback) => {
      const metrics = await getMetrics();
      callback({ ...reply, body: String(metrics.uptimeSeconds) });
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
    await until(() => received.length === 1);
    expect(received[0].type).toBe(WORKER_EVENT.METRICS_REQUEST);
    server.send({ type: WORKER_EVENT.METRICS, requestId: 'r', event: { uptimeSeconds: 7 } as never });
    await until(() => received.length === 2);

    expect(received[1]).toMatchObject({ type: WORKER_EVENT.RESPONSE, event: { body: Buffer.from('7') } });
    close();
  });

  it('keeps a websocket connection until it closes: messages in, messages out, the close acknowledged', async () => {
    const { server, session, received, types, close } = setup(async (event, callback) => {
      if (event.closed) return callback({ ...reply, statusCode: 1000 });
      if (event.frame === undefined) return callback({ statusCode: 101, headers: {}, body: '', isBase64Encoded: false });
      callback({ sendWsMessage: true, frame: event.frame.toUpperCase() } as never);
    });

    server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: { ...request, protocol: Protocols.websocket } });
    await until(() => types().includes(WORKER_EVENT.RESPONSE));
    expect(session.contexts.get('r')?.webSocket).toBeDefined();

    server.send({ type: WORKER_EVENT.WS_MESSAGE_RECEIVE, requestId: 'r', event: { body: 'hi' } });
    await until(() => types().includes(WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE));
    expect(received.find(({ type }) => type === WORKER_EVENT.WS_MESSAGE_SEND)).toMatchObject({ event: { body: 'HI' } });

    server.send({ type: WORKER_EVENT.WS_CONNECTION_CLOSE, requestId: 'r', event: request });
    await until(() => types().includes(WORKER_EVENT.WS_CONNECTION_CLOSE_ACKNOWLEDGE));
    expect(session.contexts.size).toBe(0);
    close();
  });

  describe('a response whose connection was handed over', () => {
    /** a worker that asks for the connection, writes the body to it and gives it back, and the result of giving it back */
    const handingBack = () => {
      const outcome: { handedBack?: unknown } = {};
      const worker: InvokableWorker = async (_event, callback) => {
        const socket = await callback({ statusCode: 200, headers: { 'Content-Length': '5' }, handOff: true });
        if (!(socket instanceof net.Socket)) return;

        socket.write('hello');
        outcome.handedBack = await callback({ statusCode: 200, headers: { 'Content-Length': '5' }, handOff: true, handBack: socket });
      };

      return { worker, outcome };
    };
    const handOff = (keepAlive: boolean) => ({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'r', timeout: 0, keepAlive });

    it('gives the connection back after the body, with what was read from it, when the head promised that it goes on', async () => {
      const sendHandBack = jest.fn((_message: HandBackMessage, _socket: net.Socket) => Promise.resolve());
      const { worker, outcome } = handingBack();
      const { server, session, received, close } = setup(worker, sendHandBack);
      const pair = await createSocketPair();
      const body = new Promise<string>((resolve) => pair.client.once('data', (chunk) => resolve(chunk.toString())));

      server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
      await until(() => received.some(({ type }) => type === WORKER_EVENT.RESPONSE_HANDOFF));
      session.receiveHandOff(handOff(true), pair.connection);
      pair.client.write('GET /next');
      await until(() => sendHandBack.mock.calls.length > 0);

      expect(await body).toBe('hello');
      expect(sendHandBack.mock.calls[0][0]).toEqual({ type: WORKER_EVENT.RESPONSE_HANDBACK, requestId: 'r', leftover: expect.any(String) });
      expect(sendHandBack.mock.calls[0][1]).toBe(pair.connection);
      await until(() => outcome.handedBack !== undefined);
      expect(outcome.handedBack).toBe(true);
      expect(received.map(({ type }) => type)).toEqual([WORKER_EVENT.RESPONSE_HANDOFF]);
      await pair.close();
      close();
    });

    it('closes the connection and gives nothing back when the head said that it is closed', async () => {
      const sendHandBack = jest.fn((_message: HandBackMessage, _socket: net.Socket) => Promise.resolve());
      const { worker, outcome } = handingBack();
      const { server, session, received, close } = setup(worker, sendHandBack);
      const pair = await createSocketPair();
      const everything = readUntilClosed(pair.client);

      server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
      await until(() => received.some(({ type }) => type === WORKER_EVENT.RESPONSE_HANDOFF));
      session.receiveHandOff(handOff(false), pair.connection);

      expect(await everything).toBe('hello');
      await until(() => outcome.handedBack !== undefined);
      expect(outcome.handedBack).toBe(false);
      expect(sendHandBack).not.toHaveBeenCalled();
      await pair.close();
      close();
    });

    it('closes the connection when it could not be sent back', async () => {
      const sendHandBack = jest.fn(() => Promise.reject(new Error('closed')));
      const { worker, outcome } = handingBack();
      const { server, session, received, close } = setup(worker, sendHandBack);
      const pair = await createSocketPair();
      const everything = readUntilClosed(pair.client);

      server.send({ type: WORKER_EVENT.REQUEST, requestId: 'r', event: request });
      await until(() => received.some(({ type }) => type === WORKER_EVENT.RESPONSE_HANDOFF));
      session.receiveHandOff(handOff(true), pair.connection);

      expect(await everything).toBe('hello');
      await until(() => outcome.handedBack !== undefined);
      expect(outcome.handedBack).toBe(false);
      await pair.close();
      close();
    });
  });

  describe('a request whose connection was handed over', () => {
    const handOff = {
      type: WORKER_EVENT.REQUEST_HANDOFF,
      requestId: 'h',
      event: request,
      prefix: Buffer.from('a').toString('base64'),
      length: 2,
      timeout: 0,
      keepAlive: false,
    };

    it('reads the body from the connection, answers on it and tells the server when it is closed', async () => {
      let body = '';
      const { session, received, close } = setup(async ({ bodyStream }, callback) => {
        for await (const chunk of bodyStream) body += chunk;
        callback({ ...reply, body });
      });
      const pair = await createSocketPair();
      const response = readUntilClosed(pair.client);

      session.receiveHandOff(handOff, pair.connection);
      pair.client.write('b');
      await until(() => received.length > 0);

      expect(body).toBe('ab');
      expect(await response).toContain('200');
      expect(received).toMatchObject([{ type: WORKER_EVENT.REQUEST_HANDOFF_DONE, requestId: 'h', event: { statusCode: 200 } }]);
      await pair.close();
      close();
    });

    it('gives the connection back instead of telling that it is closed when the server allowed to keep it', async () => {
      const sendHandBack = jest.fn((_message: RequestHandBackMessage, _socket: net.Socket) => Promise.resolve());
      const { session, received, close } = setup(async ({ bodyStream }, callback) => {
        for await (const chunk of bodyStream) void chunk;
        callback(reply);
      }, sendHandBack);
      const pair = await createSocketPair();
      const head = new Promise<string>((resolve) => pair.client.once('data', (chunk) => resolve(chunk.toString())));

      session.receiveHandOff({ ...handOff, keepAlive: true }, pair.connection);
      pair.client.write('bGET /next');
      await until(() => sendHandBack.mock.calls.length > 0);

      expect(await head).toContain('Connection: keep-alive');
      const [[message, socket]] = sendHandBack.mock.calls;
      expect(message).toEqual({
        type: WORKER_EVENT.REQUEST_HANDBACK,
        requestId: 'h',
        event: { statusCode: 200, headers: { 'Content-Length': '2' } },
        leftover: Buffer.from('GET /next').toString('base64'),
      });
      expect(socket).toBe(pair.connection);
      expect(received).toEqual([]);
      await pair.close();
      close();
    });

    it('closes the connection and tells the server when the worker has no way to give it back', async () => {
      const { session, received, close } = setup(async ({ bodyStream }, callback) => {
        for await (const chunk of bodyStream) void chunk;
        callback(reply);
      });
      const pair = await createSocketPair();
      const response = readUntilClosed(pair.client);

      session.receiveHandOff({ ...handOff, keepAlive: true }, pair.connection);
      pair.client.write('b');
      await until(() => received.length > 0);

      expect(await response).toContain('Connection: close');
      expect(received).toMatchObject([{ type: WORKER_EVENT.REQUEST_HANDOFF_DONE, requestId: 'h' }]);
      await pair.close();
      close();
    });

    it('answers a worker that throws with a 500 and logs the error', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { session, received, close } = setup(() => {
        throw new Error('fails');
      });
      const pair = await createSocketPair();
      const response = readUntilClosed(pair.client);

      session.receiveHandOff(handOff, pair.connection);
      await until(() => received.length > 0);

      expect(await response).toContain('500');
      expect(received).toMatchObject([{ type: WORKER_EVENT.REQUEST_HANDOFF_DONE, event: { statusCode: 500 } }]);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
      await pair.close();
      close();
    });

    it('drops the questions of the worker for metrics once the connection is closed', async () => {
      const { session, received, close } = setup(async ({ getMetrics }) => {
        getMetrics();
      });
      const pair = await createSocketPair();

      session.receiveHandOff(handOff, pair.connection);
      await until(() => received.length > 0);
      expect(session.contexts.size).toBe(1);
      pair.client.destroy();
      await until(() => received.length > 1);

      expect(received.map(({ type }) => type)).toEqual([WORKER_EVENT.METRICS_REQUEST, WORKER_EVENT.REQUEST_HANDOFF_DONE]);
      expect(session.contexts.size).toBe(0);
      await pair.close();
      close();
    });
  });

  it('ignores the messages of requests it does not know', () => {
    const { server, session, close } = setup(jest.fn());

    server.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId: 'x' });
    server.send({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'x', event: { body: null } });
    server.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId: 'x' });

    expect(session.contexts.size).toBe(0);
    close();
  });

  it('passes what the IPC channel carries to the hand-off bookkeeping', () => {
    const { session, close } = setup(jest.fn());

    expect(() => session.receiveHandOff({ requestId: 'x' }, undefined)).not.toThrow();
    close();
  });
});
