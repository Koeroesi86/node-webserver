import net from 'net';
import { WebSocketWindow } from '../constants';
import createWsConnection from './create-ws-connection';
import type { WsConnectionOptions } from './create-ws-connection';
import { clientClose, clientFrame } from './ws-client-frame.test-helper';

describe('createWsConnection', () => {
  let server: net.Server;
  let sockets: net.Socket[];

  beforeEach(async () => {
    sockets = [];
    server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
  });

  /** a connection on the server side of a socket, and the client side that reads what the server writes */
  const connect = async (options: Partial<WsConnectionOptions> = {}, { open = true } = {}) => {
    const messages: Array<string | Buffer> = [];
    const accepted = new Promise<net.Socket>((resolve) => server.once('connection', resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
    const received: Buffer[] = [];
    client.on('data', (chunk) => received.push(chunk));
    const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
    const ended = new Promise<void>((resolve) => client.on('end', () => resolve()));
    const socket = await accepted;
    sockets.push(socket, client);
    // the http parser of a real server also reads the socket
    socket.on('data', () => {});

    const connection = createWsConnection(socket, {
      limitMessage: 0,
      pingInterval: 0,
      idleTimeout: 0,
      onMessage: (data) => messages.push(data),
      ...options,
    });
    if (open) connection.open();
    socket.on('data', connection.receive);

    client.on('error', () => {});
    /** waits for the data to have arrived, which the server reads as soon as the loop turns */
    const until = async (condition: () => boolean) => {
      for (let waited = 0; !condition() && waited < 3000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(condition()).toBe(true);
    };
    /** writes, and returns once the server has read it */
    let written = 0;
    const write = async (bytes: Buffer) => {
      written += bytes.length;
      client.write(bytes);
      await until(() => socket.bytesRead >= written || socket.destroyed);
    };

    return { connection, socket, client, messages, closed, ended, write, until, received: () => Buffer.concat(received) };
  };

  it('passes on the messages of the client', async () => {
    const { messages, write, until } = await connect();

    await write(Buffer.concat([clientFrame('one'), clientFrame(Buffer.from([1, 2]), { opcode: 0x2 })]));
    await until(() => messages.length === 2);

    expect(messages).toEqual(['one', Buffer.from([1, 2])]);
  });

  it('reads nothing before the upgrade was accepted', async () => {
    const { connection, messages, write, until } = await connect({}, { open: false });

    await write(clientFrame('too early'));
    connection.open();
    await write(clientFrame('in time'));
    await until(() => messages.length > 0);

    expect(messages).toEqual(['in time']);
  });

  it('answers a ping with a pong that has its data, without bothering the worker', async () => {
    const { messages, write, until, received } = await connect();

    await write(clientFrame('beat', { opcode: 0x9 }));
    await until(() => received().length === 6);

    expect([...received()]).toEqual([0x8a, 4, ...Buffer.from('beat')]);
    expect(messages).toEqual([]);
  });

  it('answers a close with a close and ends the connection', async () => {
    const { write, ended, received } = await connect();

    await write(clientClose(1001));
    await ended;

    expect([...received()]).toEqual([0x88, 2, 1001 >> 8, 1001 & 255]);
  });

  it('closes a client that breaks the protocol, and passes on nothing after that', async () => {
    const { messages, write, ended, received } = await connect();

    await write(Buffer.concat([clientFrame('unmasked', { masked: false }), clientFrame('after')]));
    await ended;

    expect(received().readUInt16BE(2)).toBe(1002);
    expect(messages).toEqual([]);
  });

  it('closes a client that sends a message above the limit', async () => {
    const { write, ended, received } = await connect({ limitMessage: 10 });

    await write(clientFrame('x'.repeat(11)));
    await ended;

    expect(received().readUInt16BE(2)).toBe(1009);
  });

  describe('towards the worker', () => {
    it('pauses the socket when the worker has not taken the messages that were sent, and goes on when it takes them', async () => {
      const { connection, socket, messages, write, until } = await connect();

      await write(Buffer.concat(Array.from({ length: WebSocketWindow.messages }, (_, index) => clientFrame(`m${index}`))));
      await until(() => messages.length === WebSocketWindow.messages);
      expect(socket.isPaused()).toBe(true);

      connection.acknowledge();

      expect(socket.isPaused()).toBe(false);
    });

    it('does not pause while the worker takes the messages', async () => {
      const { connection, socket, messages, write, until } = await connect();

      for (let index = 0; index < WebSocketWindow.messages * 2; index += 1) {
        await write(clientFrame(`m${index}`));
        await until(() => messages.length === index + 1);
        connection.acknowledge();
      }

      expect(socket.isPaused()).toBe(false);
    });

    it('pauses the socket when the bytes that were not taken reach the window, whatever their number', async () => {
      const { socket, messages, write, until } = await connect();

      await write(clientFrame(Buffer.alloc(WebSocketWindow.bytes, 1), { opcode: 0x2 }));
      await until(() => messages.length === 1);

      expect(socket.isPaused()).toBe(true);
    });

    it('reads the socket again when it closes, to get the end of the client', async () => {
      const { connection, socket, messages, write, until } = await connect();
      await write(Buffer.concat(Array.from({ length: WebSocketWindow.messages }, () => clientFrame('x'))));
      await until(() => messages.length === WebSocketWindow.messages);

      connection.close(1000);

      expect(socket.isPaused()).toBe(false);
    });
  });

  describe('towards the client', () => {
    it('writes a text message and a binary message', async () => {
      const { connection, until, received } = await connect();

      connection.send('hi', () => {});
      connection.send(Buffer.from([9, 8]), () => {});
      await until(() => received().length === 8);

      expect([...received()]).toEqual([0x81, 2, ...Buffer.from('hi'), 0x82, 2, 9, 8]);
    });

    it('tells that a message was written', async () => {
      const { connection } = await connect();

      expect(await new Promise((resolve) => connection.send('hi', resolve))).toBe(true);
    });

    it('does not write after a close, and tells so', async () => {
      const { connection, ended } = await connect();

      connection.close(1000);
      await ended;

      expect(await new Promise((resolve) => connection.send('late', resolve))).toBe(false);
    });

    it('closes a client that does not read what is written to it instead of buffering it without a limit', async () => {
      const { connection, socket, received, ended } = await connect();
      Object.defineProperty(socket, 'writableLength', { value: Number.MAX_SAFE_INTEGER });

      const written = await new Promise((resolve) => connection.send('x', resolve));
      await ended;

      expect(written).toBe(false);
      expect(received().readUInt16BE(2)).toBe(1008);
    });

    it('sends the close frame with the code and the reason of the worker', async () => {
      const { connection, ended, received } = await connect();

      connection.close(4001, 'done');
      await ended;

      expect(received().readUInt16BE(2)).toBe(4001);
      expect(received().subarray(4).toString()).toBe('done');
    });
  });

  describe('keeping the connection alive', () => {
    it('pings the client', async () => {
      const { until, received, connection } = await connect({ pingInterval: 10 });

      await until(() => received().length >= 2);
      connection.dispose();

      expect([...received().subarray(0, 2)]).toEqual([0x89, 0]);
    });

    it('closes a client that stays silent for the idle time', async () => {
      const { closed, received, ended } = await connect({ pingInterval: 10, idleTimeout: 50 });

      await ended;
      await closed;

      expect(received().readUInt16BE(received().length - 2 - 'Idle.'.length)).toBe(1001);
    });

    it('stops its timers when it is disposed', async () => {
      const { connection, received } = await connect({ pingInterval: 5 });

      connection.dispose();
      const length = received().length;
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(received()).toHaveLength(length);
    });
  });
});
