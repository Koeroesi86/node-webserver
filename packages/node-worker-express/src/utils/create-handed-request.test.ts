import type net from 'net';
import { WORKER_EVENT } from '../constants';
import type { RequestHandOffMessage } from '../types';
import createHandedRequest from './create-handed-request';
import { createSocketPair, readUntilClosed } from './socket-pair.test-helper';

describe('createHandedRequest', () => {
  let client: net.Socket;
  let connection: net.Socket;
  let close: () => Promise<unknown>;

  beforeEach(async () => {
    ({ client, connection, close } = await createSocketPair());
  });

  afterEach(() => close());

  const message = (overrides: Partial<RequestHandOffMessage> = {}): RequestHandOffMessage => ({
    type: WORKER_EVENT.REQUEST_HANDOFF,
    requestId: 'a',
    event: { httpMethod: 'POST', protocol: 'HTTP', path: '/', pathFragments: [], queryStringParameters: {}, headers: {}, remoteAddress: '', rootPath: '' },
    prefix: Buffer.from('ab').toString('base64'),
    length: 4,
    timeout: 0,
    keepAlive: false,
    ...overrides,
  });
  /** the connection is closed on the end of the worker a little after the client saw it */
  const untilClosed = async (onClosed: jest.Mock) => {
    for (let waited = 0; onClosed.mock.calls.length === 0 && waited < 3000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const readAll = async (stream: AsyncIterable<Buffer>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    return Buffer.concat(chunks).toString();
  };

  it('reads the body from the connection and answers on it, and says how it went once the connection is closed', async () => {
    const onClosed = jest.fn();
    const received = readUntilClosed(client);
    const handed = createHandedRequest({ message: message(), socket: connection, onClosed });
    client.write('cd');

    expect(await readAll(handed.bodyStream)).toBe('abcd');
    expect(handed.hasResponded()).toBe(false);
    await handed.respond({ statusCode: 202, body: 'ok' });

    expect(handed.hasResponded()).toBe(true);
    expect(await received).toMatch(/^HTTP\/1\.1 202 Accepted\r\n/);
    await untilClosed(onClosed);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith({ statusCode: 202, headers: { 'Content-Length': '2' } });
  });

  it('says that nothing was written when the client leaves, and fails the body', async () => {
    const onClosed = jest.fn();
    const handed = createHandedRequest({ message: message(), socket: connection, onClosed });
    const body = readAll(handed.bodyStream);
    client.destroy();

    await expect(body).rejects.toThrow('The request was aborted.');
    await untilClosed(onClosed);
    expect(onClosed).toHaveBeenCalledWith({ statusCode: 0, headers: { 'Content-Length': '0' } });
  });

  it('closes the connection when the client is quiet for the timeout', async () => {
    const onClosed = jest.fn();
    const received = readUntilClosed(client);
    createHandedRequest({ message: message({ timeout: 50 }), socket: connection, onClosed });

    expect(await received).toBe('');
    await untilClosed(onClosed);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('does not close the connection by itself without a timeout', async () => {
    const onClosed = jest.fn();
    createHandedRequest({ message: message({ timeout: 0 }), socket: connection, onClosed });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onClosed).not.toHaveBeenCalled();
  });
  describe('when the connection may go on', () => {
    const handBack = () => jest.fn((_summary: unknown, _socket: net.Socket, _leftover: Buffer) => Promise.resolve());
    /** the text that arrived, for a connection that stays open */
    const readHead = () =>
      new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        client.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          if (Buffer.concat(chunks).includes('\r\n\r\n')) setImmediate(() => resolve(Buffer.concat(chunks).toString()));
        });
      });

    it('gives the connection back after the response, with how it went and what came behind the body, instead of closing it', async () => {
      const onClosed = jest.fn();
      const onHandBack = handBack();
      const head = readHead();
      const handed = createHandedRequest({ message: message({ keepAlive: true }), socket: connection, onClosed, onHandBack });
      client.write('cdGET /next');

      expect(await readAll(handed.bodyStream)).toBe('abcd');
      await handed.respond({ statusCode: 202, body: 'ok' });

      expect(await head).toContain('Connection: keep-alive\r\n');
      expect(onHandBack).toHaveBeenCalledTimes(1);
      const [summary, socket, leftover] = onHandBack.mock.calls[0];
      expect(summary).toEqual({ statusCode: 202, headers: { 'Content-Length': '2' } });
      expect(socket).toBe(connection);
      expect(leftover.toString()).toBe('GET /next');
      connection.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onClosed).not.toHaveBeenCalled();
    });

    it('closes the connection when the worker answers before the body was read', async () => {
      const onClosed = jest.fn();
      const onHandBack = handBack();
      const received = readUntilClosed(client);
      const handed = createHandedRequest({ message: message({ keepAlive: true }), socket: connection, onClosed, onHandBack });

      await handed.respond({ statusCode: 413, body: 'too big' });

      expect(await received).toContain('Connection: close\r\n');
      expect(onHandBack).not.toHaveBeenCalled();
      await untilClosed(onClosed);
      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('closes the connection when the server did not allow to keep it', async () => {
      const onHandBack = handBack();
      const received = readUntilClosed(client);
      const handed = createHandedRequest({ message: message({ keepAlive: false }), socket: connection, onClosed: jest.fn(), onHandBack });
      client.write('cd');
      await readAll(handed.bodyStream);

      await handed.respond({ statusCode: 200, body: 'ok' });

      expect(await received).toContain('Connection: close\r\n');
      expect(onHandBack).not.toHaveBeenCalled();
    });

    it('closes the connection and tells the server when it could not be given back', async () => {
      const onClosed = jest.fn();
      const onHandBack = jest.fn(() => Promise.reject(new Error('no channel')));
      const received = readUntilClosed(client);
      const handed = createHandedRequest({ message: message({ keepAlive: true }), socket: connection, onClosed, onHandBack });
      client.write('cd');
      await readAll(handed.bodyStream);

      await handed.respond({ statusCode: 200, body: 'ok' });

      expect(await received).toContain('Connection: keep-alive\r\n');
      await untilClosed(onClosed);
      expect(onClosed).toHaveBeenCalledWith({ statusCode: 200, headers: { 'Content-Length': '2' } });
    });
  });
});
