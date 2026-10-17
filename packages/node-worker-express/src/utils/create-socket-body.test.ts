import net from 'net';
import createSocketBody from './create-socket-body';
import { createSocketPair } from './socket-pair.test-helper';

describe('createSocketBody', () => {
  let client: net.Socket;
  let connection: net.Socket;
  let close: () => Promise<unknown>;

  beforeEach(async () => {
    ({ client, connection, close } = await createSocketPair());
  });

  afterEach(() => close());

  const readAll = async (stream: AsyncIterable<Buffer>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    return Buffer.concat(chunks).toString();
  };

  it('reads the part that had arrived, then the rest from the connection, up to the length', async () => {
    const { stream: body } = createSocketBody(connection, Buffer.from('abc'), 9);
    client.write('def');
    client.write('ghi');

    expect(await readAll(body)).toBe('abcdefghi');
  });

  it('ends at once when the part that had arrived is the whole body', async () => {
    expect(await readAll(createSocketBody(connection, Buffer.from('abc'), 3).stream)).toBe('abc');
  });

  it('ends at once for a body of no bytes', async () => {
    expect(await readAll(createSocketBody(connection, Buffer.alloc(0), 0).stream)).toBe('');
  });

  it('leaves the bytes after the length out', async () => {
    const { stream: body } = createSocketBody(connection, Buffer.alloc(0), 4);
    client.write('abcdefgh');

    expect(await readAll(body)).toBe('abcd');
  });

  it('does not read the connection before the body is read', async () => {
    const { stream: body } = createSocketBody(connection, Buffer.alloc(0), 4);
    const received = jest.fn();
    connection.on('data', received);
    connection.pause();
    client.write('abcd');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).not.toHaveBeenCalled();
    expect(await readAll(body)).toBe('abcd');
  });

  it('ends with an error when the connection closes before the whole body arrived', async () => {
    const { stream: body } = createSocketBody(connection, Buffer.from('ab'), 10);
    client.destroy();

    await expect(readAll(body)).rejects.toThrow('The request was aborted.');
  });
  describe('behind the body', () => {
    const untilEnded = (stream: AsyncIterable<Buffer>) => readAll(stream);

    it('says when the body is whole, and keeps the bytes after it for whoever takes the connection', async () => {
      const body = createSocketBody(connection, Buffer.alloc(0), 4);
      expect(body.isComplete()).toBe(false);
      client.write('abcdGET /next');

      expect(await untilEnded(body.stream)).toBe('abcd');
      expect(body.isComplete()).toBe(true);
      expect(body.takeLeftover().toString()).toBe('GET /next');
      expect(body.takeLeftover()).toHaveLength(0);
    });

    it('is whole at once when the part that had arrived is the body', () => {
      expect(createSocketBody(connection, Buffer.from('abc'), 3).isComplete()).toBe(true);
    });

    it('stops reading the connection once the body is whole', async () => {
      const body = createSocketBody(connection, Buffer.alloc(0), 4);
      client.write('abcd');
      await untilEnded(body.stream);
      client.write('next');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // the socket keeps it for whoever takes the connection, it is not dropped for lack of a reader
      expect(connection.isPaused()).toBe(true);
      expect(connection.read()?.toString()).toBe('next');
    });
  });
});
