import crypto from 'crypto';
import net from 'net';
import createChannel from './createChannel';
import type { WireMessage } from './frames';

/** the two ends of a connected socket pair, like the one to a worker */
const connect = async () => {
  const accepted = new Promise<net.Socket>((resolve) => {
    server.once('connection', resolve);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('The server does not listen on a port.');
  const client = net.connect(address.port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));

  return { client, server: await accepted };
};

let server: net.Server;
let sockets: net.Socket[] = [];

const until = async (condition: () => boolean) => {
  for (let waited = 0; !condition() && waited < 3000; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
};

describe('createChannel', () => {
  beforeAll(async () => {
    server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  afterEach(() => {
    sockets.forEach((socket) => socket.destroy());
    sockets = [];
  });

  const open = async () => {
    const ends = await connect();
    sockets.push(ends.client, ends.server);
    const received: { left: WireMessage[]; right: WireMessage[] } = { left: [], right: [] };

    return {
      ends,
      received,
      left: createChannel<WireMessage, WireMessage>(ends.client, (message) => received.left.push(message)),
      right: createChannel<WireMessage, WireMessage>(ends.server, (message) => received.right.push(message)),
    };
  };

  it('delivers messages in both directions', async () => {
    const { left, right, received } = await open();

    left.send({ type: 'REQUEST', requestId: 'a', event: { path: '/', body: 'text' } });
    right.send({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: Buffer.from('bytes') } });

    await until(() => received.left.length === 1 && received.right.length === 1);
    expect(received.right[0]).toEqual({ type: 'REQUEST', requestId: 'a', event: { path: '/', body: 'text' } });
    expect(received.left[0]).toEqual({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: Buffer.from('bytes') } });
  });

  it('keeps the order and the content of many messages, big ones included', async () => {
    const { left, received } = await open();
    const bodies = Array.from({ length: 200 }, (_, index) => crypto.randomBytes(index % 10 === 0 ? 300000 : index));

    bodies.forEach((body, index) => left.send({ type: 'RESPONSE', requestId: String(index), event: { body } }));

    await until(() => received.right.length === bodies.length);
    received.right.forEach((message, index) => {
      expect(message.requestId).toBe(String(index));
      // not toEqual, which compares megabytes byte by byte
      expect(bodies[index].equals(Buffer.from(message.event.body))).toBe(true);
    });
  });

  it('writes the messages of one turn of the event loop together', async () => {
    const { ends, left, received } = await open();
    const writev = jest.spyOn(ends.client, '_writev');
    const write = jest.spyOn(ends.client, '_write');

    Array.from({ length: 50 }).forEach((_, index) => left.send({ type: 'ACK', requestId: String(index) }));

    await until(() => received.right.length === 50);
    expect(writev.mock.calls.length + write.mock.calls.length).toBe(1);
  });

  it('does not hold messages back beyond the turn it was sent in', async () => {
    const { left, received } = await open();

    left.send({ type: 'ACK', requestId: 'a' });
    await until(() => received.right.length === 1);
    left.send({ type: 'ACK', requestId: 'b' });

    await until(() => received.right.length === 2);
  });

  it('does not write to a stream that is gone', async () => {
    const { ends, left } = await open();
    const write = jest.spyOn(ends.client, 'write');
    ends.client.destroy();

    expect(() => left.send({ type: 'ACK', requestId: 'a' })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(write).not.toHaveBeenCalled();
  });

  it('closes the stream instead of going on after garbage', async () => {
    const { ends, received } = await open();
    const closed = new Promise((resolve) => ends.server.once('close', resolve));

    const garbage = Buffer.alloc(16);
    garbage.writeUInt32LE(12, 0);
    ends.client.write(garbage);

    await closed;
    expect(received.right).toHaveLength(0);
  });
});
