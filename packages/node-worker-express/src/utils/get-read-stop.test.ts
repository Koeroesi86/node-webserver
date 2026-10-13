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

  it('is not there for a socket without a handle', () => {
    expect(getReadStop(new net.Socket())).toBeUndefined();
  });
});
