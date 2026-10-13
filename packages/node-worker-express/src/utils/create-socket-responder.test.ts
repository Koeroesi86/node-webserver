import type net from 'net';
import createSocketResponder from './create-socket-responder';
import { createSocketPair, readUntilClosed } from './socket-pair.test-helper';

describe('createSocketResponder', () => {
  let client: net.Socket;
  let connection: net.Socket;
  let close: () => Promise<unknown>;
  let responder: ReturnType<typeof createSocketResponder>;
  let received: Promise<string>;

  beforeEach(async () => {
    ({ client, connection, close } = await createSocketPair());
    // the handed over request listens for the errors of the connection, a close is where they are handled
    connection.on('error', () => {});
    responder = createSocketResponder(connection);
    received = readUntilClosed(client);
  });

  afterEach(() => close());

  it('writes a response in one piece with the length of the body and closes the connection after it', async () => {
    await responder.callback({ statusCode: 201, headers: { 'Content-Type': 'text/plain' }, body: 'made' });

    expect(await received).toBe('HTTP/1.1 201 Created\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nmade');
    expect(responder.summary()).toEqual({ statusCode: 201, bytes: 4 });
  });

  it('decodes a base64 body', async () => {
    await responder.callback({ statusCode: 200, body: Buffer.from('árvíz').toString('base64'), isBase64Encoded: true });

    expect(await received).toContain(`Content-Length: ${Buffer.byteLength('árvíz')}\r\nConnection: close\r\n\r\nárvíz`);
  });

  it('keeps the length the worker gave', async () => {
    await responder.callback({ statusCode: 200, headers: { 'content-length': '2' }, body: 'ok' });

    expect((await received).match(/content-length/gi)).toHaveLength(1);
  });

  it('writes the values of a header that is given more than once as lines of their own', async () => {
    await responder.callback({ statusCode: 200, headers: { 'Set-Cookie': ['a=1', 'b=2'] as unknown as string }, body: '' });

    expect(await received).toContain('Set-Cookie: a=1\r\nSet-Cookie: b=2\r\n');
  });

  it.each([204, 304])('sends no length and no body for a %i', async (statusCode) => {
    await responder.callback({ statusCode, body: 'ignored' });

    const text = await received;
    expect(text).not.toContain('Content-Length');
    expect(text.endsWith('\r\n\r\n')).toBe(true);
    expect(responder.summary().bytes).toBe(0);
  });

  it('drops the headers that say how the body is framed, they are set here', async () => {
    await responder.callback({ statusCode: 200, headers: { Connection: 'keep-alive', 'Transfer-Encoding': 'chunked' }, body: 'x' });

    const text = await received;
    expect(text).toContain('Connection: close\r\n');
    expect(text).not.toMatch(/keep-alive|chunked/);
  });

  it('answers 500 instead of writing a header that is not valid', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await responder.callback({ statusCode: 200, headers: { 'X-Bad': 'a\r\nInjected: yes' }, body: 'x' });

    const text = await received;
    expect(text).toMatch(/^HTTP\/1\.1 500 Internal Server Error\r\n/);
    expect(text.endsWith('Internal Server Error')).toBe(true);
    expect(text).not.toContain('Injected');
    expect(responder.summary().statusCode).toBe(500);
  });

  it('writes the parts of a streamed response, the first one with the head, and ends with the part without a body', async () => {
    const emit = (body: Buffer | null) => responder.callback({ statusCode: 200, headers: { 'X-Part': 'yes' }, emit: true, body });

    expect(responder.hasResponded()).toBe(false);
    await expect(emit(Buffer.from('one'))).resolves.toBe(true);
    expect(responder.hasResponded()).toBe(true);
    await expect(emit(Buffer.from('two'))).resolves.toBe(true);
    await expect(emit(null)).resolves.toBe(true);

    expect(await received).toBe('HTTP/1.1 200 OK\r\nX-Part: yes\r\nConnection: close\r\n\r\nonetwo');
    expect(responder.summary()).toEqual({ statusCode: 200, bytes: 6 });
  });

  it('answers 500 and ends when the head of a streamed response is not valid', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await responder.callback({ statusCode: 200, headers: { 'X-Bad': 'a\nb' }, emit: true, body: Buffer.from('x') });

    expect(await received).toMatch(/^HTTP\/1\.1 500 .*Internal Server Error$/s);
    await expect(responder.callback({ statusCode: 200, emit: true, body: Buffer.from('more') })).resolves.toBeUndefined();
  });

  it('resolves a part with false when the client is gone', async () => {
    client.destroy();
    // the server end only learns that the client left by reading
    connection.resume();
    await new Promise((resolve) => connection.once('close', resolve));

    await expect(responder.callback({ statusCode: 200, emit: true, body: Buffer.from('x') })).resolves.toBe(false);
  });

  it('refuses to hand the connection over again, and ignores websocket messages and what comes after the end', async () => {
    await expect(responder.callback({ statusCode: 200, handOff: true })).resolves.toBeUndefined();
    await expect(responder.callback({ sendWsMessage: true, frame: 'x' })).resolves.toBeUndefined();
    await responder.callback({ statusCode: 200, body: 'first' });
    await expect(responder.callback({ statusCode: 500, body: 'second' })).resolves.toBeUndefined();

    expect(await received).not.toContain('second');
  });
});
