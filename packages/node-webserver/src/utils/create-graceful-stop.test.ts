import { once } from 'events';
import http from 'http';
import net from 'net';
import createGracefulStop from './create-graceful-stop';

jest.mock('@koeroesi86/node-worker-express', () => ({ closeWebSockets: jest.fn() }));

const { closeWebSockets } = jest.requireMock('@koeroesi86/node-worker-express');

describe('createGracefulStop', () => {
  let server: http.Server;
  let port: number;
  let release: Array<() => void>;
  let arrived: () => void;
  let requestArrived: Promise<void>;
  const agents: http.Agent[] = [];

  beforeEach(async () => {
    release = [];
    requestArrived = new Promise<void>((resolve) => (arrived = resolve));
    server = http.createServer((request, response) => {
      if (request.url === '/hold') {
        response.writeHead(200, { 'Content-Length': '2' });
        response.write('o');
        release.push(() => response.end('k'));
        arrived();
        return;
      }
      response.end('ok');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as net.AddressInfo).port;
    jest.mocked(closeWebSockets).mockClear();
  });

  afterEach(() => {
    agents.splice(0).forEach((agent) => agent.destroy());
    server.closeAllConnections();
    server.close();
  });

  const get = (path: string, agent?: http.Agent) =>
    new Promise<{ status: number | undefined; body: string; connection: string | undefined; socket: net.Socket | null }>((resolve, reject) => {
      const outgoing = http.get({ host: '127.0.0.1', port, path, agent: agent ?? false }, (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('error', reject);
        response.on('close', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(parts).toString(), connection: response.headers.connection, socket: outgoing.socket })
        );
      });
      outgoing.on('error', reject);
    });

  it('answers the request in flight, stops the listener, closes the websockets and then stops what is behind', async () => {
    const order: string[] = [];
    const stopBehind = jest.fn(async () => {
      order.push('behind');
    });
    const stop = createGracefulStop([server], stopBehind);
    const reply = get('/hold');
    await requestArrived;

    server.once('close', () => order.push('closed'));
    const stopped = stop(60000).then(() => order.push('stopped'));
    expect(closeWebSockets).toHaveBeenCalled();
    expect(stopBehind).not.toHaveBeenCalled();
    release.forEach((done) => done());

    const answered = await reply;
    await stopped;
    expect(answered).toMatchObject({ status: 200, body: 'ok', connection: 'close' });
    expect(order).toEqual(['closed', 'behind', 'stopped']);
  });

  it('refuses new connections once it started', async () => {
    const stop = createGracefulStop([server], async () => {});

    await stop(60000);

    await expect(get('/')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('closes a connection that is idle', async () => {
    const stop = createGracefulStop([server], async () => {});
    const agent = new http.Agent({ keepAlive: true });
    agents.push(agent);
    const { socket } = await get('/', agent);
    const closed = once(socket as net.Socket, 'close');

    await stop(60000);

    await closed;
  });

  it('cuts what is left after the timeout, and stops what is behind with the time that is left', async () => {
    const stopBehind = jest.fn(async () => {});
    const stop = createGracefulStop([server], stopBehind);
    const reply = get('/hold');
    const failed = expect(reply).rejects.toThrow();
    await requestArrived;

    await stop(50);

    await failed;
    const [timeLeft] = stopBehind.mock.calls[0] as unknown as [number];
    expect(timeLeft).toBeLessThanOrEqual(50);
    expect(timeLeft).toBeGreaterThanOrEqual(0);
  });
});
