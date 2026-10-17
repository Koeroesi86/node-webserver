import type net from 'net';
import detachConnection from './detach-connection';
import { createSocketPair } from './socket-pair.test-helper';

describe('detachConnection', () => {
  let client: net.Socket;
  let connection: net.Socket;
  let close: () => Promise<unknown>;

  beforeEach(async () => {
    ({ client, connection, close } = await createSocketPair({ paused: false }));
  });

  afterEach(() => close());

  it('returns what the connection had read, and stops it from reading more', async () => {
    connection.on('error', () => {});
    client.write('GET /next');
    await new Promise((resolve) => connection.once('readable', resolve));

    const read = detachConnection(connection);
    client.write('more');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(read.toString()).toBe('GET /next');
    expect(connection.isPaused()).toBe(true);
    expect(connection.readableLength).toBe(0);
  });

  it('returns nothing for a connection that read nothing', () => {
    expect(detachConnection(connection)).toHaveLength(0);
  });

  it('takes the timeout off the connection', () => {
    const setTimeout = jest.spyOn(connection, 'setTimeout');

    detachConnection(connection);

    expect(setTimeout).toHaveBeenCalledWith(0);
  });
});
