import crypto from 'crypto';
import { WORKER_EVENT, WorkerBusyError } from '@koeroesi86/node-worker/pool';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { WebSocketWindow } from '../constants';
import { clientFrame } from '../utils/ws-client-frame.test-helper';
import { setupMiddlewareTest, type Handlers } from './middleware.test-helper';

jest.mock('@koeroesi86/node-worker/pool', () => require('./fake-pool.test-helper').createFakePoolModule());

const FakePool = jest.requireMock('@koeroesi86/node-worker/pool').WorkerPool;

describe('workerMiddleware', () => {
  const { t, until, settle, start, mockLease } = setupMiddlewareTest();

  describe('websockets', () => {
    type Message = { type: string; requestId: string; event?: { body?: Buffer | string; headers?: Record<string, string> } };

    const upgraded = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({
        type: WORKER_EVENT.RESPONSE,
        requestId,
        event: { statusCode: 101, headers: { Upgrade: 'websocket', Connection: 'Upgrade' }, body: Buffer.from('') },
      });

    /** a lease whose worker accepts the upgrade, or answers it with `upgrade`. `answer` reacts to the other messages. */
    const mockSocketLease = (answer: (message: Message, handlers: Handlers) => void = () => {}, upgrade = upgraded) => {
      let handlers: Handlers;
      const stream = { on: jest.fn(), off: jest.fn() };
      const lease = {
        worker: { instance: { stdout: stream, stderr: stream } },
        send: jest.fn((message: Message) =>
          setImmediate(() => {
            if (message.type === WORKER_EVENT.REQUEST) upgrade(handlers, message.requestId);
            answer(message, handlers);
          })
        ),
        subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
          handlers = { onMessage, onExit };
        }),
        release: jest.fn(),
      };
      FakePool.last.acquire.mockResolvedValue(lease);

      return lease;
    };

    const messagesOf = (lease: ReturnType<typeof mockSocketLease>, type: string) =>
      lease.send.mock.calls.map(([message]) => message).filter((message) => message.type === type);

    const clients: net.Socket[] = [];
    let serverSockets: net.Socket[];

    beforeEach(() => {
      serverSockets = [];
    });

    afterEach(() => clients.splice(0).forEach((client) => client.destroy()));

    /** opens a websocket connection with the headers of an upgrade, and waits for the answer of the server */
    const connect = async (requestPath = '/') => {
      t.server.on('connection', (socket) => serverSockets.push(socket));
      const client = net.connect(Number(new URL(t.baseUrl).port), '127.0.0.1');
      clients.push(client);
      const received: Buffer[] = [];
      client.on('data', (chunk) => received.push(chunk));
      client.on('error', () => {});
      const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
      const ended = new Promise<void>((resolve) => client.on('end', () => resolve()));
      client.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto
          .randomBytes(16)
          .toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
      await until(() => Buffer.concat(received).includes('\r\n\r\n'));
      const head = Buffer.concat(received).toString();
      received.splice(0);

      return { client, closed, ended, head, received: () => Buffer.concat(received), write: (bytes: Buffer) => client.write(bytes) };
    };

    it('answers with what the worker answers, and passes the messages of the client on once the upgrade was accepted', async () => {
      await start();
      const lease = mockSocketLease();

      const { head, write } = await connect();
      write(Buffer.concat([clientFrame('hello'), clientFrame(Buffer.from([1, 2, 3]), { opcode: 0x2 })]));
      await until(() => messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).length === 2);

      expect(head).toContain('101 Switching Protocols');
      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).map(({ event }) => event)).toEqual([{ body: 'hello' }, { body: Buffer.from([1, 2, 3]) }]);
    });

    it('passes a message that comes in pieces on once, and a small one like any other', async () => {
      await start();
      const lease = mockSocketLease();

      const { write } = await connect();
      const frame = clientFrame('x'.repeat(300));
      write(frame.subarray(0, 5));
      write(frame.subarray(5, 100));
      write(frame.subarray(100));
      write(clientFrame('hi'));
      await until(() => messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).length === 2);

      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE).map(({ event }) => event.body)).toEqual(['x'.repeat(300), 'hi']);
    });

    it('holds the client back while the worker has not taken the messages it was sent', async () => {
      await start();
      const lease = mockSocketLease();

      const { write } = await connect();
      write(Buffer.concat(Array.from({ length: WebSocketWindow.messages }, (_, index) => clientFrame(`m${index}`))));
      await until(() => serverSockets[0].isPaused());
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      lease.subscribe.mock.calls[0][1]({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId });

      expect(serverSockets[0].isPaused()).toBe(false);
    });

    it('writes the messages of the worker to the client, and acknowledges them once they are written', async () => {
      await start();
      const lease = mockSocketLease();

      const { received } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: 'text' } });
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: Buffer.from([7]) } });
      await until(() => received().length === 9);

      expect([...received()]).toEqual([0x81, 4, ...Buffer.from('text'), 0x82, 1, 7]);
      await until(() => messagesOf(lease, WORKER_EVENT.RESPONSE_ACKNOWLEDGE).length === 2);
    });

    it('sends the messages of the same turn in one write', async () => {
      await start();
      const lease = mockSocketLease();

      const { received } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      Array.from({ length: 5 }, (_, index) => onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { body: `m${index}` } }));

      // held back until the turn is over, then written together
      expect(serverSockets[0].writableCorked).toBe(1);
      await until(() => received().length === 20);
      expect(serverSockets[0].writableCorked).toBe(0);
    });

    it('closes the connection when the worker says so', async () => {
      await start();
      const lease = mockSocketLease();

      const { received, ended } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId, event: { close: { code: 4000, reason: 'done' } } });
      await ended;

      expect(received().readUInt16BE(2)).toBe(4000);
      expect(received().subarray(4).toString()).toBe('done');
    });

    it('tells the worker and frees it when the client goes away', async () => {
      await start();
      const lease = mockSocketLease();

      const { client } = await connect();
      client.destroy();
      await until(() => lease.release.mock.calls.length > 0);

      expect(messagesOf(lease, WORKER_EVENT.WS_CONNECTION_CLOSE)).toHaveLength(1);
    });

    it('does not tell the worker about a closing connection for a plain request', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } })
      );

      await fetch(`${t.baseUrl}/`);
      t.server.closeAllConnections();
      await settle();

      expect(lease.send.mock.calls.filter(([message]) => message.type === WORKER_EVENT.WS_CONNECTION_CLOSE)).toHaveLength(0);
    });

    it('closes a client that breaks the protocol, and frees the worker when it is gone', async () => {
      await start();
      const lease = mockSocketLease();

      const { write, received, ended, client } = await connect();
      write(clientFrame('unmasked', { masked: false }));
      await ended;
      client.destroy();

      expect(received().readUInt16BE(2)).toBe(1002);
      await until(() => lease.release.mock.calls.length > 0);
      expect(messagesOf(lease, WORKER_EVENT.WS_MESSAGE_RECEIVE)).toHaveLength(0);
    });

    it('closes a client that sends a message above the limit', async () => {
      await start({ limitWebSocketMessage: 10 });
      mockSocketLease();

      const { write, received, ended } = await connect();
      write(clientFrame('x'.repeat(11)));
      await ended;

      expect(received().readUInt16BE(2)).toBe(1009);
    });

    it('answers 503 for the connections above the limit of a worker, and takes the next one when one is gone', async () => {
      await start({ limitWebSocketConnections: 1 });
      const lease = mockSocketLease();

      const first = await connect();
      const second = await connect();
      first.client.destroy();
      await until(() => lease.release.mock.calls.length > 0);
      const third = await connect();

      expect(first.head).toContain('101');
      expect(second.head).toContain('503');
      expect(second.head).toContain('Retry-After');
      expect(third.head).toContain('101');
    });

    it('does not count the connections of another worker', async () => {
      await start({ limitWebSocketConnections: 1 });
      mockSocketLease();
      await fs.mkdir(path.join(t.root, 'other'), { recursive: true });
      await fs.writeFile(path.join(t.root, 'other', 'exampleWorker.js'), '');

      const first = await connect('/');
      const second = await connect('/other');

      expect(first.head).toContain('101');
      expect(second.head).toContain('101');
    });

    it('gives the slot back when no worker could be had', async () => {
      await start({ limitWebSocketConnections: 1 });
      mockSocketLease();
      FakePool.last.acquire.mockRejectedValueOnce(new WorkerBusyError('/x', 'busy'));

      const first = await connect();
      const second = await connect();

      expect(first.head).toContain('503');
      expect(second.head).toContain('101');
    });

    it('frees the worker and the slot at once when the upgrade is refused', async () => {
      await start({ limitWebSocketConnections: 1 });
      const lease = mockSocketLease(undefined, (handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 400, headers: {}, body: Buffer.from('no') } })
      );

      const { head } = await connect();
      await until(() => lease.release.mock.calls.length > 0);

      expect(head).toContain('400');
    });

    it('ignores a second answer to the upgrade instead of failing', async () => {
      await start();
      const lease = mockSocketLease();

      const { client } = await connect();
      const [, onMessage] = lease.subscribe.mock.calls[0];
      const [{ requestId }] = messagesOf(lease, WORKER_EVENT.REQUEST);
      onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 101, headers: {}, body: Buffer.from('') } });
      await settle();

      expect(client.destroyed).toBe(false);
    });

    it('does not close the connection for being quiet when the keep alive timeout of the server passes', async () => {
      await start();
      t.server.keepAliveTimeout = 5000;
      const setTimeoutOfSocket = jest.spyOn(net.Socket.prototype, 'setTimeout');
      mockSocketLease();

      await connect();
      await until(() => setTimeoutOfSocket.mock.calls.at(-1)?.[0] === 0);

      expect(serverSockets[0].timeout).toBe(0);
      setTimeoutOfSocket.mockRestore();
    });
  });
});
