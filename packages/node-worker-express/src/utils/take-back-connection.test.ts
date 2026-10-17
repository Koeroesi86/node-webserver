import net from 'net';
import takeBackConnection from './take-back-connection';

describe('takeBackConnection', () => {
  let accepting: net.Server;
  const sockets: net.Socket[] = [];

  beforeEach(async () => {
    accepting = net.createServer();
    await new Promise<void>((resolve) => accepting.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.destroy());
    await new Promise((resolve) => accepting.close(resolve));
  });

  const socket = () => {
    const created = new net.Socket();
    sockets.push(created);

    return created;
  };

  it('gives the connection to the server as a new one, which starts with what the worker read from it', () => {
    const taken = socket();
    const connection = jest.fn((received: net.Socket) => received.readableLength);
    accepting.on('connection', connection);

    expect(takeBackConnection(accepting, taken, Buffer.from('GET /'))).toBe(true);

    expect(connection).toHaveBeenCalledWith(taken);
    expect(connection.mock.results[0].value).toBe(5);
    expect(taken.allowHalfOpen).toBe(true);
  });

  it('puts nothing in front of the connection when the worker read nothing', () => {
    const taken = socket();
    const connection = jest.fn((received: net.Socket) => received.readableLength);
    accepting.on('connection', connection);

    takeBackConnection(accepting, taken, Buffer.alloc(0));

    expect(connection.mock.results[0].value).toBe(0);
  });

  it.each([
    ['a server that stopped accepting connections', () => new net.Server()],
    ['something that is not a server', () => undefined],
  ])('closes the connection for %s', (_name, create) => {
    const taken = socket();

    expect(takeBackConnection(create(), taken, Buffer.from('x'))).toBe(false);
    expect(taken.destroyed).toBe(true);
  });
});
