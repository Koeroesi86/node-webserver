import express from 'express';
import { WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import http from 'http';
import net from 'net';
import { isRequestHandedOff, requestHandOffDoneEvent } from '../utils/is-handed-off';
import workerMiddleware from './index';
import { setupMiddlewareTest, type Handlers } from './middleware.test-helper';

jest.mock('@koeroesi86/node-worker/pool', () => require('./fake-pool.test-helper').createFakePoolModule());

describe('workerMiddleware', () => {
  const { t, until, settle, start, mockLease } = setupMiddlewareTest();

  describe('streamed responses', () => {
    /** every byte value, as text decoding would damage the ones above 127 */
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
    const part = (requestId: string, body: Buffer | null) => ({
      type: WORKER_EVENT.RESPONSE_EMIT,
      requestId,
      event: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        emit: true,
        body,
      },
    });

    it('writes the bytes of every part to the client and acknowledges them once they are written', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => {
        handlers.onMessage(part(requestId, bytes));
        handlers.onMessage(part(requestId, bytes));
        handlers.onMessage(part(requestId, null));
      });

      const response = await fetch(`${t.baseUrl}/`);

      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.concat([bytes, bytes]));
      const acknowledgements = lease.send.mock.calls.filter(([message]) => message.type === WORKER_EVENT.RESPONSE_ACKNOWLEDGE);
      expect(acknowledgements).toHaveLength(3);
    });

    it('tells the worker to stop when the client goes away during the response', async () => {
      await start();
      const lease = mockLease((handlers, requestId) => handlers.onMessage(part(requestId, bytes)));

      await new Promise<void>((resolve, reject) => {
        const clientRequest = http.get(`${t.baseUrl}/`, (response) =>
          response.once('data', () => {
            response.destroy();
            resolve();
          })
        );
        clientRequest.on('error', reject);
      });
      // the server notices that the client left a moment later
      for (let waited = 0; !lease.send.mock.calls.some(([message]) => message.type === WORKER_EVENT.REQUEST_ABORT) && waited < 3000; waited += 5) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(lease.send).toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
      expect(lease.release).toHaveBeenCalled();
    });

    it('does not tell the worker to stop after a complete response', async () => {
      await start();
      const lease = mockLease((handlers, requestId) =>
        handlers.onMessage({ type: WORKER_EVENT.RESPONSE, requestId, event: { statusCode: 200, headers: {}, body: Buffer.from('done') } })
      );

      await (await fetch(`${t.baseUrl}/`)).text();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lease.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: WORKER_EVENT.REQUEST_ABORT }));
    });

    it('ends a response early when the worker stops sending parts', async () => {
      await start({ limitResponseTimeout: 50 });
      const lease = mockLease((handlers, requestId) => handlers.onMessage(part(requestId, bytes)));

      const response = await fetch(`${t.baseUrl}/`);

      await expect(response.arrayBuffer()).rejects.toThrow();
      expect(lease.release).toHaveBeenCalled();
    });

    it('keeps a response going while parts keep coming, even if it takes longer than the timeout', async () => {
      // the parts come in a fifth of the timeout, which a slow machine can be late for, and all of them together take longer than it
      await start({ limitResponseTimeout: 150 });
      mockLease((handlers, requestId) => {
        const send = (index: number) => {
          handlers.onMessage(part(requestId, index < 8 ? bytes : null));
          if (index < 8) setTimeout(() => send(index + 1), 30);
        };
        send(0);
      });

      const response = await fetch(`${t.baseUrl}/`);

      expect((await response.arrayBuffer()).byteLength).toBe(bytes.length * 8);
    });
  });

  describe('handing the connection to the worker', () => {
    const body = Buffer.from('a body that the worker writes itself');
    const head = (requestId: string, headers: Record<string, string> = { 'Content-Length': String(body.length) }) => ({
      type: WORKER_EVENT.RESPONSE_HANDOFF,
      requestId,
      event: { statusCode: 200, headers: { 'Content-Type': 'application/octet-stream', ...headers } },
    });
    const end = (requestId: string) => ({ type: WORKER_EVENT.RESPONSE_EMIT, requestId, event: { statusCode: 200, emit: true, body: null } });
    const sentTypes = (lease: { send: jest.Mock }) => lease.send.mock.calls.map(([message]) => message.type);

    /** a worker that asks for the connection, writes the body to it once it has it, and then tells that it is done */
    const handingOver = (headers?: Record<string, string>) => {
      let handlers: Handlers;
      const lease = mockLease((current, requestId) => {
        handlers = current;
        handlers.onMessage(head(requestId, headers));
      });
      const handOff = jest.fn(
        (message: { requestId: string }, socket: net.Socket) =>
          new Promise<void>((resolve) =>
            socket.write(body, () => {
              resolve();
              setImmediate(() => handlers.onMessage(end(message.requestId)));
            })
          )
      );

      return Object.assign(lease, { handOff });
    };

    it('hands the connection over for a big response, which closes after the body, and frees the worker when it is done', async () => {
      await start({ handOffResponses: body.length, limitResponseTimeout: 300 });
      const lease = handingOver();

      const response = await fetch(`${t.baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('connection')).toBe('close');
      expect(response.headers.get('content-length')).toBe(String(body.length));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
      expect(lease.handOff).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: expect.any(String), timeout: 300 }, expect.any(net.Socket));
      await until(() => lease.release.mock.calls.length > 0);
      expect(sentTypes(lease)).toEqual([WORKER_EVENT.REQUEST, WORKER_EVENT.RESPONSE_ACKNOWLEDGE]);
    });

    it('keeps a response below the size and lets the worker stream it', async () => {
      await start({ handOffResponses: body.length + 1 });
      const lease = handingOver();

      const request = fetch(`${t.baseUrl}/`);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.RESPONSE_HANDOFF_REFUSE));

      expect(lease.handOff).not.toHaveBeenCalled();
      lease.subscribe.mock.calls[0][1](end(lease.subscribe.mock.calls[0][0]));
      expect((await request).headers.get('connection')).not.toBe('close');
    });

    it('keeps a response without a length', async () => {
      await start({ handOffResponses: 1 });
      const lease = handingOver({});

      fetch(`${t.baseUrl}/`).catch(() => undefined);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.RESPONSE_HANDOFF_REFUSE));

      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('keeps a response to HEAD', async () => {
      await start({ handOffResponses: 1 });
      const lease = handingOver();

      fetch(`${t.baseUrl}/`, { method: 'HEAD' }).catch(() => undefined);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.RESPONSE_HANDOFF_REFUSE));

      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('keeps a response that a middleware in front encodes, which then passes through it with the head that was written', async () => {
      const app = express();
      app.use((request, response, next) => {
        const { writeHead } = response;
        // what the compression does when it takes a response
        Object.assign(response, {
          writeHead: (...args: unknown[]) => {
            response.setHeader('Content-Encoding', 'identity');
            response.removeHeader('Content-Length');
            return Reflect.apply(writeHead, response, args);
          },
        });
        next();
      });
      app.use(workerMiddleware({ root: t.root, index: ['exampleWorker.js'], handOffResponses: 1 }));
      t.server = http.createServer(app);
      await new Promise<void>((resolve) => t.server.listen(0, resolve));
      const lease = handingOver();
      const { send } = lease;
      // the refusal is answered with the body passing through the server
      Object.assign(lease, {
        send: jest.fn((message: { type: string; requestId: string }) => {
          send(message as never);
          if (message.type !== WORKER_EVENT.RESPONSE_HANDOFF_REFUSE) return;
          const onMessage = lease.subscribe.mock.calls[0][1];
          onMessage({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: message.requestId, event: { statusCode: 200, emit: true, body } });
          onMessage(end(message.requestId));
        }),
      });

      const response = await fetch(`http://localhost:${(t.server.address() as net.AddressInfo).port}/`);

      expect(response.headers.get('content-encoding')).toBe('identity');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('ends the response and frees the worker when the connection could not be handed over', async () => {
      await start({ handOffResponses: 1 });
      const lease = handingOver();
      lease.handOff.mockRejectedValueOnce(new Error('closed'));

      await expect(fetch(`${t.baseUrl}/`).then((response) => response.arrayBuffer())).rejects.toThrow();

      await until(() => lease.release.mock.calls.length > 0);
      expect(sentTypes(lease)).toContain(WORKER_EVENT.REQUEST_ABORT);
    });

    it('frees the worker when it exits while it writes the body', async () => {
      await start({ handOffResponses: 1 });
      let handlers: Handlers;
      const lease = Object.assign(
        mockLease((current, requestId) => {
          handlers = current;
          handlers.onMessage(head(requestId));
        }),
        { handOff: jest.fn(() => Promise.resolve()) }
      );

      fetch(`${t.baseUrl}/`).catch(() => undefined);
      await until(() => lease.handOff.mock.calls.length > 0);
      await settle();
      expect(lease.release).not.toHaveBeenCalled();

      handlers.onExit(1);

      expect(lease.release).toHaveBeenCalled();
    });
  });

  describe('handing the connection of a request to the worker', () => {
    const upload = Buffer.alloc(200 * 1024, 'u');
    const done = (requestId: string, statusCode = 201) => ({
      type: WORKER_EVENT.REQUEST_HANDOFF_DONE,
      requestId,
      event: { statusCode, headers: { 'Content-Length': '2' } },
    });
    const sentTypes = (lease: { send: jest.Mock }) => lease.send.mock.calls.map(([message]) => message.type);
    const post = (body: BodyInit, headers: Record<string, string> = {}) =>
      fetch(`${t.baseUrl}/`, { method: 'POST', body, headers, ...(body instanceof ReadableStream && { duplex: 'half' }) });

    /** a worker that is given the connection, answers on it and says that it is done */
    const takingOver = () => {
      const lease = mockLease(() => {});
      const handOff = jest.fn(
        (message: { requestId: string; prefix?: string }, socket: net.Socket) =>
          new Promise<void>((resolve) => {
            let missing = upload.length - Buffer.from(message.prefix ?? '', 'base64').length;
            const answer = () =>
              socket.write('HTTP/1.1 201 Created\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok', () => {
                resolve();
                setImmediate(() => lease.subscribe.mock.calls[0][1](done(message.requestId)));
              });
            // like the real worker, read the rest of the body before answering: the server destroys the socket once this resolves, and closing it with unread bytes resets the
            // connection on windows, so the client loses the answer. The parser of the server listens no more, it is not the one reading the body now.
            socket.removeAllListeners('data');
            socket.on('data', (chunk) => {
              missing -= chunk.length;
              if (missing <= 0) answer();
            });
            // the server stopped libuv from reading before the handoff; start it again and tell node, or its own restart on the first chunk fails with EALREADY
            const handle = Reflect.get(socket, '_handle');
            Reflect.apply(Reflect.get(handle, 'readStart'), handle, []);
            Reflect.set(handle, 'reading', true);
            socket.resume();
            if (missing <= 0) answer();
          })
      );

      return Object.assign(lease, { handOff });
    };

    it('hands the connection over for a big body, with the request and what had arrived of the body, which the worker answers on', async () => {
      await start({ handOffRequests: 100 * 1024, inlineRequestBody: 0, limitResponseTimeout: 300 });
      const lease = takingOver();

      const response = await post(upload);

      expect(response.status).toBe(201);
      expect(await response.text()).toBe('ok');
      const [[message, socket]] = lease.handOff.mock.calls;
      expect(message).toEqual({
        type: WORKER_EVENT.REQUEST_HANDOFF,
        requestId: expect.any(String),
        event: expect.objectContaining({
          httpMethod: 'POST',
          path: '/',
          hasBody: true,
          headers: expect.objectContaining({ 'content-length': String(upload.length) }),
        }),
        prefix: expect.any(String),
        length: upload.length,
        timeout: 300,
      });
      expect(socket).toBeInstanceOf(net.Socket);
      const prefix = Buffer.from(message.prefix, 'base64');
      expect(prefix.length).toBeLessThanOrEqual(upload.length);
      expect(prefix.equals(upload.subarray(0, prefix.length))).toBe(true);
      await until(() => lease.release.mock.calls.length > 0);
      expect(sentTypes(lease)).toEqual([]);
    });

    it('streams a body below the size through the server', async () => {
      await start({ handOffRequests: upload.length + 1, inlineRequestBody: 0 });
      const lease = takingOver();

      post(upload).catch(() => undefined);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.REQUEST));

      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('streams the body when it is not switched on', async () => {
      await start({ inlineRequestBody: 0 });
      const lease = takingOver();

      post(upload).catch(() => undefined);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.REQUEST));

      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('streams a chunked body, whose length is not known', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0 });
      const lease = takingOver();
      const chunks = new ReadableStream({
        start(controller) {
          controller.enqueue(upload);
          controller.close();
        },
      });

      post(chunks).catch(() => undefined);
      await until(() => sentTypes(lease).includes(WORKER_EVENT.REQUEST));

      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('keeps a body that is announced bigger than the limit here, to be answered with 413', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0, limitRequestBody: upload.length - 1 });
      const lease = takingOver();

      const response = await post(upload);

      expect(response.status).toBe(413);
      expect(lease.handOff).not.toHaveBeenCalled();
    });

    it('hands over a body that is as big as the limit', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0, limitRequestBody: upload.length });
      const lease = takingOver();

      expect((await post(upload)).status).toBe(201);
      expect(lease.handOff).toHaveBeenCalled();
    });

    it('answers 502 and frees the worker when the connection could not be handed over', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0 });
      const lease = takingOver();
      lease.handOff.mockRejectedValueOnce(new Error('closed'));

      expect((await post(upload)).status).toBe(502);

      await until(() => lease.release.mock.calls.length > 0);
    });

    it('frees the worker when it exits while it has the connection', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0 });
      const lease = Object.assign(
        mockLease(() => {}),
        { handOff: jest.fn(() => Promise.resolve()) }
      );

      post(upload).catch(() => undefined);
      await until(() => lease.handOff.mock.calls.length > 0);
      await settle();
      expect(lease.release).not.toHaveBeenCalled();

      lease.subscribe.mock.calls[0][2](1);

      expect(lease.release).toHaveBeenCalled();
    });

    it('sets the status the worker wrote on the response and tells whoever listens, once the worker is done', async () => {
      await start({ handOffRequests: 1, inlineRequestBody: 0 });
      const lease = takingOver();
      const finished = jest.fn();
      t.server.on('request', (request, response) =>
        response.once(requestHandOffDoneEvent, () => finished(response.statusCode, response.getHeader('content-length'), isRequestHandedOff(response)))
      );

      await post(upload);

      await until(() => finished.mock.calls.length > 0);
      expect(finished).toHaveBeenCalledWith(201, '2', true);
      expect(lease.release).toHaveBeenCalled();
    });
  });
});
