import { RequestBodyWindow, WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { setupMiddlewareTest, type Handlers } from './middleware.test-helper';

jest.mock('@koeroesi86/node-worker/pool', () => require('./fake-pool.test-helper').createFakePoolModule());

const FakePool = jest.requireMock('@koeroesi86/node-worker/pool').WorkerPool;

describe('workerMiddleware', () => {
  const { t, until, settle, start, mockLease } = setupMiddlewareTest();

  describe('streamed request bodies', () => {
    type Message = { type: string; requestId: string; event?: { body?: Buffer | null; hasBody?: boolean } };

    /** a lease whose worker is told every message that was sent to it, `answer` decides how it reacts */
    const mockUploadLease = (answer: (message: Message, handlers: Handlers) => void) => {
      let handlers: Handlers;
      const stream = { on: jest.fn(), off: jest.fn() };
      const lease = {
        worker: { instance: { stdout: stream, stderr: stream } },
        send: jest.fn((message: Message) => setImmediate(() => answer(message, handlers))),
        subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
          handlers = { onMessage, onExit };
        }),
        release: jest.fn(),
      };
      FakePool.last.acquire.mockResolvedValue(lease);

      return lease;
    };

    const messagesOf = (lease: ReturnType<typeof mockUploadLease>, type: string) =>
      lease.send.mock.calls.map(([message]) => message).filter((message) => message.type === type);
    const bytesOf = (lease: ReturnType<typeof mockUploadLease>) =>
      Buffer.concat(
        messagesOf(lease, WORKER_EVENT.REQUEST_BODY)
          .filter(({ event }) => event.body !== null)
          .map(({ event }) => event.body)
      );
    const acknowledge = (handlers: Handlers, requestId: string) => handlers.onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });
    const respond = (handlers: Handlers, requestId: string, statusCode = 200, body = 'done') =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode, headers: {}, body: Buffer.from(body) } });

    /** acknowledges every part of the body and answers when it ended */
    const answerWhenEnded = (message: Message, handlers: Handlers) => {
      if (message.type !== WORKER_EVENT.REQUEST_BODY) return;
      if (message.event.body === null) respond(handlers, message.requestId);
      else acknowledge(handlers, message.requestId);
    };

    const send = (chunks: Buffer[], { method = 'POST', requestPath = '/' } = {}) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = http.request(`${t.baseUrl}${requestPath}`, { method }, (response) => {
          const parts: Buffer[] = [];
          response.on('data', (part) => parts.push(part));
          response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(parts).toString() }));
        });
        request.on('error', reject);
        chunks.forEach((chunk) => request.write(chunk));
        request.end();
      });

    it('hands the body to the worker in parts that make up the body, and ends them', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const body = crypto.randomBytes(300000);

      const response = await send([body]);

      expect(response).toEqual({ status: 200, text: 'done' });
      const parts = messagesOf(lease, WORKER_EVENT.REQUEST_BODY);
      expect(parts.length).toBeGreaterThan(2);
      expect(parts[parts.length - 1].event.body).toBeNull();
      expect(bytesOf(lease).equals(body)).toBe(true);
    });

    it('sends the request without its body and says that the body follows', async () => {
      // streamed, as even a small body that arrived with the request would go along with it otherwise
      await start({ inlineRequestBody: 0 });
      const lease = mockUploadLease(answerWhenEnded);

      await send([Buffer.from('hello')]);

      const [request] = messagesOf(lease, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('body');
    });

    it('calls the worker before the body has arrived, and passes on what comes later', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const request = http.request(`${t.baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});
      const answered = new Promise((resolve) => request.on('response', resolve));

      request.write('first ');
      await until(() => bytesOf(lease).toString() === 'first ');
      expect(messagesOf(lease, WORKER_EVENT.REQUEST)).toHaveLength(1);
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_BODY).every(({ event }) => event.body !== null)).toBe(true);

      request.end('second');
      await answered;
      expect(bytesOf(lease).toString()).toBe('first second');
    });

    it('holds the body back while the worker has not taken the parts it was sent', async () => {
      await start();
      const lease = mockUploadLease(() => {});
      const request = http.request(`${t.baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});

      // many times the window
      Array.from({ length: 40 }).forEach(() => request.write(Buffer.alloc(65536)));
      // the window is sent, and then it is held back: give what is not allowed to follow the time to arrive
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length >= RequestBodyWindow);
      await settle();
      const sentWithoutAcknowledgement = messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length;
      expect(sentWithoutAcknowledgement).toBe(RequestBodyWindow);

      const [requestId, onMessage] = lease.subscribe.mock.calls[0];
      onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_BODY).length === sentWithoutAcknowledgement + 1);
      await settle();
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_BODY)).toHaveLength(sentWithoutAcknowledgement + 1);
      request.destroy();
    });

    it('does not stream requests that have no body', async () => {
      await start();
      const lease = mockUploadLease((message, handlers) => message.type === WORKER_EVENT.REQUEST && respond(handlers, message.requestId));

      await send([], { method: 'GET' });

      expect(messagesOf(lease, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });

    it('does not take the worker away when the body has been read, while it works on the answer', async () => {
      await start({ limitResponseTimeout: 2000, inlineRequestBody: 0 });
      const lease = mockUploadLease((message, handlers) => {
        if (message.type !== WORKER_EVENT.REQUEST_BODY) return;
        if (message.event.body === null) setTimeout(() => respond(handlers, message.requestId, 200, 'late answer'), 200);
        else acknowledge(handlers, message.requestId);
      });

      const response = await send([Buffer.from('hello')]);

      expect(response).toEqual({ status: 200, text: 'late answer' });
      expect(messagesOf(lease, WORKER_EVENT.REQUEST_ABORT)).toHaveLength(0);
    });

    it('tells the worker when the client goes away during the upload', async () => {
      await start();
      const lease = mockUploadLease(answerWhenEnded);
      const request = http.request(`${t.baseUrl}/`, { method: 'POST' });
      request.on('error', () => {});

      request.write('part of it');
      await until(() => bytesOf(lease).length > 0);
      request.destroy();

      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_ABORT).length > 0);
      expect(lease.release).toHaveBeenCalled();
    });

    it('answers 413 and tells the worker when the body exceeds the limit for the body', async () => {
      await start({ limitRequestBody: 100000 });
      const lease = mockUploadLease(answerWhenEnded);

      const response = await send([Buffer.alloc(500000)]).catch(() => ({ status: 413, text: '' }));

      expect(response.status).toBe(413);
      await until(() => messagesOf(lease, WORKER_EVENT.REQUEST_ABORT).length > 0);
    });

    it('lets a body that is within the limit for the body through', async () => {
      await start({ limitRequestBody: 100000 });
      mockUploadLease(answerWhenEnded);

      expect((await send([Buffer.alloc(99999)])).status).toBe(200);
    });

    it('reads and drops the rest of a body that the worker did not wait for', async () => {
      await start();
      // answers while the upload is held back, as the worker has not taken the parts it was sent
      let parts = 0;
      mockUploadLease((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST_BODY && (parts += 1) === RequestBodyWindow) respond(handlers, message.requestId, 413, 'too large');
      });

      const connections: net.Socket[] = [];
      t.server.on('connection', (socket) => connections.push(socket));

      const response = await send([Buffer.alloc(20 * 1024 * 1024)]);

      expect(response).toEqual({ status: 413, text: 'too large' });
      // the whole upload is taken from the connection, which otherwise could not be used for the next request
      await until(() => connections[0].bytesRead >= 20 * 1024 * 1024);
      await settle();
    });

    it('does not stream the body of a request that the static worker answers', async () => {
      await start();
      const lease = mockUploadLease((message, handlers) => message.type === WORKER_EVENT.REQUEST && respond(handlers, message.requestId));

      await send([Buffer.from('hello')], { requestPath: '/plain/file.txt' });

      expect(FakePool.last.acquire).toHaveBeenCalledWith(
        expect.stringMatching(/staticWorker\.js$/),
        expect.anything(),
        expect.anything(),
        expect.any(AbortSignal)
      );
      expect(messagesOf(lease, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });
  });

  describe('bodies for the static worker', () => {
    it('reads and drops them', async () => {
      await start();
      mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 404, headers: {}, body: Buffer.from('missing') } })
      );
      const connections: net.Socket[] = [];
      t.server.on('connection', (socket) => connections.push(socket));

      // a client that sends all of it, as a browser does, where fetch gives up its upload when the answer arrives
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(`${t.baseUrl}/plain/file.txt`, { method: 'POST' }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end(Buffer.alloc(20 * 1024 * 1024));
      });

      expect(status).toBe(404);
      // the whole upload is taken from the connection, which otherwise could not be used for the next request
      for (let waited = 0; connections[0].bytesRead < 20 * 1024 * 1024 && waited < 3000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(connections[0].bytesRead).toBeGreaterThanOrEqual(20 * 1024 * 1024);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe('bodies that arrive with the request', () => {
    type Sent = { type: string; requestId: string; event?: { hasBody?: boolean; body?: Buffer | null } };

    /** answers the request as soon as it is there, and the parts of a body as they come */
    const answerAtOnce = (message: Sent, handlers: Handlers) => {
      if (message.type === WORKER_EVENT.REQUEST) respond(handlers, message.requestId);
      if (message.type === WORKER_EVENT.REQUEST_BODY) acknowledge(handlers, message.requestId);
    };
    const respond = (handlers: Handlers, requestId: string) =>
      handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('ok') } });
    const acknowledge = (handlers: Handlers, requestId: string) => handlers.onMessage({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId });

    interface Lease {
      send: jest.Mock<unknown, [Sent]>;
      subscribe: jest.Mock;
      release: jest.Mock;
    }

    const mockLeaseAnswering = (answer: (message: Sent, handlers: Handlers) => void = answerAtOnce) => {
      const created: Lease[] = [];
      FakePool.last.acquire.mockImplementation(async () => {
        let handlers: Handlers;
        const stream = { on: jest.fn(), off: jest.fn() };
        const lease = {
          worker: { instance: { stdout: stream, stderr: stream } },
          send: jest.fn((message: Sent) => setImmediate(() => answer(message, handlers))),
          subscribe: jest.fn((requestId: string, onMessage: Handlers['onMessage'], onExit: Handlers['onExit']) => {
            handlers = { onMessage, onExit };
          }),
          release: jest.fn(),
        };
        created.push(lease);

        return lease;
      });

      return created;
    };

    const messagesOf = (leases: Lease[], type: string): Sent[] =>
      leases.flatMap(({ send }) => send.mock.calls.map(([message]) => message)).filter((message) => message.type === type);

    /** sends a request over a socket of its own, in the writes that are given: whatever is in one write arrives together, which fetch does not let one decide */
    const rawRequest = (head: string, writes: Array<Buffer | string>, beforeNextWrite?: () => Promise<unknown>) =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(new URL(t.baseUrl).port), '127.0.0.1');
        const received: Buffer[] = [];
        socket.on('data', (chunk) => received.push(chunk));
        socket.on('end', () => resolve(Buffer.concat(received).toString()));
        socket.on('error', reject);
        socket.on('connect', async () => {
          const requestHead = `${head}\r\nHost: web.localhost\r\nConnection: close\r\n\r\n`;
          // without a pause the head and the first part of the body are a single write, two writes in a row can arrive apart
          const [first, ...rest] = writes;
          const parts =
            beforeNextWrite || first === undefined ? [requestHead, ...writes] : [Buffer.concat([Buffer.from(requestHead), Buffer.from(first)]), ...rest];
          for (const part of parts) {
            socket.write(part);
            await beforeNextWrite?.();
          }
        });
      });

    /** the head and the body in a single write, so they arrive together */
    const postTogether = (body: Buffer | string, path = '/') => {
      const bytes = Buffer.from(body);

      return rawRequest(`POST ${path} HTTP/1.1\r\nContent-Length: ${bytes.length}`, [bytes]);
    };

    /** the head in a write of its own, the body in the next one, which is only written once the request has been handed on to a worker: no pause can guarantee that */
    const postApart = (body: string, leases: Lease[]) =>
      rawRequest(`POST / HTTP/1.1\r\nContent-Length: ${Buffer.byteLength(body)}`, [body], async () => {
        while (messagesOf(leases, WORKER_EVENT.REQUEST).length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      });

    it('goes along with the request when it is small, with no parts after it', async () => {
      await start();
      const leases = mockLeaseAnswering();

      const response = await postTogether('hello world');

      expect(response).toContain('200 OK');
      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(request.event.body.toString()).toBe('hello world');
      expect(request.event).not.toHaveProperty('hasBody');
      // the bytes travel as they are, not as base64 in the metadata
      expect(request.event).not.toHaveProperty('inlineBody');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('keeps every byte', async () => {
      await start();
      const leases = mockLeaseAnswering();
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));

      await postTogether(bytes);

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.body).toEqual(bytes);
    });

    it('is empty for a request of no bytes, which needs no parts either', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.body).toEqual(Buffer.alloc(0));
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('also holds for the requests after the first one, which find their way in the cache', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('first');
      await postTogether('second');
      await postTogether('third');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST).map(({ event }) => event.body.toString())).toEqual(['first', 'second', 'third']);
    });

    it('is also how a small body with chunks of its own, sent in one write, arrives', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await rawRequest('POST / HTTP/1.1\r\nTransfer-Encoding: chunked', ['5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n']);

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.body.toString()).toBe('hello world');
    });

    it('is streamed instead when the body comes after the request', async () => {
      await start();
      // the worker answers once it has the whole body, as the rest of a body is dropped when the response is done
      const leases = mockLeaseAnswering((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST_BODY && message.event.body === null) respond(handlers, message.requestId);
        if (message.type === WORKER_EVENT.REQUEST_BODY && message.event.body !== null) acknowledge(handlers, message.requestId);
      });

      await postApart('a body that was sent later', leases);

      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('body');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY).length).toBeGreaterThan(0);
    });

    it('is streamed whole, never in two ways, when it is bigger than the limit for inline bodies', async () => {
      await start({ inlineRequestBody: 100 });
      const leases = mockLeaseAnswering();

      await postTogether(Buffer.alloc(101, 1));

      const [request] = messagesOf(leases, WORKER_EVENT.REQUEST);
      expect(request.event).toMatchObject({ hasBody: true });
      expect(request.event).not.toHaveProperty('body');
      const sent = Buffer.concat(
        messagesOf(leases, WORKER_EVENT.REQUEST_BODY)
          .filter(({ event }) => event.body !== null)
          .map(({ event }) => event.body)
      );
      expect(sent).toEqual(Buffer.alloc(101, 1));
    });

    it('goes along with the request when it is exactly as big as the limit', async () => {
      await start({ inlineRequestBody: 100 });
      const leases = mockLeaseAnswering();

      await postTogether(Buffer.alloc(100, 1));

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event.body).toHaveLength(100);
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_BODY)).toHaveLength(0);
    });

    it('is always streamed with a limit of 0', async () => {
      await start({ inlineRequestBody: 0 });
      const leases = mockLeaseAnswering();

      await postTogether('small');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).toMatchObject({ hasBody: true });
      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('body');
    });

    it('is refused with 413 before a worker is asked for when it is bigger than the limit for bodies', async () => {
      await start({ limitRequestBody: 50 });
      mockLeaseAnswering();

      const response = await postTogether(Buffer.alloc(60, 1));

      expect(response).toContain('413');
      expect(FakePool.last.acquire).not.toHaveBeenCalled();
    });

    it('is let through when it is exactly as big as the limit for bodies', async () => {
      await start({ limitRequestBody: 50 });
      mockLeaseAnswering();

      expect(await postTogether(Buffer.alloc(50, 1))).toContain('200 OK');
    });

    it('is not there for requests without a body', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await rawRequest('GET / HTTP/1.1', []);

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('body');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('hasBody');
    });

    it('is not there for what the static worker answers', async () => {
      await start();
      const leases = mockLeaseAnswering();

      await postTogether('ignored', '/plain/file.txt');

      expect(messagesOf(leases, WORKER_EVENT.REQUEST)[0].event).not.toHaveProperty('body');
    });

    it('lets the worker take its time to answer, without telling it that the client left', async () => {
      await start({ limitResponseTimeout: 2000 });
      const leases = mockLeaseAnswering((message, handlers) => {
        if (message.type === WORKER_EVENT.REQUEST) setTimeout(() => respond(handlers, message.requestId), 150);
      });

      const response = await postTogether('hello');

      expect(response).toContain('200 OK');
      expect(messagesOf(leases, WORKER_EVENT.REQUEST_ABORT)).toHaveLength(0);
    });
  });
});
