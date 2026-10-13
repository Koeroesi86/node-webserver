import net from 'net';
import getReadStop from './get-read-stop';
import { createSocketPair } from './socket-pair.test-helper';

describe('getReadStop', () => {
  it('stops libuv from reading the socket, which a pause does not', async () => {
    const { client, connection, close } = await createSocketPair();
    const stop = getReadStop(connection);
    connection.on('data', () => {});
    connection.resume();
    // reading has started, as it has when the server handed a request over
    await new Promise((resolve) => setImmediate(resolve));

    stop?.();
    connection.pause();
    client.write('abc');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stop).toBeInstanceOf(Function);
    expect(connection.readableLength).toBe(0);
    await close();
  });

  it('tells node that the socket is reading, so that the resume of the http server does not start it again', async () => {
    const { connection, close } = await createSocketPair();
    const handle: unknown = Reflect.get(connection, '_handle');
    // the http server sets it to false when it pauses a socket, and starts reading on the next resume when it is
    if (typeof handle === 'object' && handle !== null) Reflect.set(handle, 'reading', false);

    getReadStop(connection)?.();

    expect(typeof handle === 'object' && handle !== null && Reflect.get(handle, 'reading')).toBe(true);
    await close();
  });

  it('reads again when asked, for a socket that was not handed over', async () => {
    const { client, connection, close } = await createSocketPair();
    const received: Buffer[] = [];
    connection.on('data', (chunk) => received.push(chunk));
    connection.pause();

    const resume = getReadStop(connection)?.();
    client.write('abc');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(0);

    resume?.();
    await new Promise((resolve) => connection.once('data', resolve));

    expect(Buffer.concat(received).toString()).toBe('abc');
    await close();
  });

  it('is not there for a socket without a handle', () => {
    expect(getReadStop(new net.Socket())).toBeUndefined();
  });
});
