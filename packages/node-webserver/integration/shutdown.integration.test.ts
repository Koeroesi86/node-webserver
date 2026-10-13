import { once } from 'events';
import http from 'http';
import net from 'net';
import { until } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import { connectWebSocket } from './helpers/websocket-client';
import type { RunningServer } from './helpers/start-server';

// a signal other than SIGINT or SIGTERM cannot be sent to a process on Windows, which ends it at once, and neither can the second one be told from the first
const describeWithSignals = process.platform === 'win32' ? describe.skip : describe;

/** an application that starts to answer a request and finishes it once it is told to, registered as the target of `proxy.localhost` */
const holdingApplication = async (server: RunningServer) => {
  let finish = () => {};
  const received = new Promise<void>((resolve) => (finish = resolve));
  const held: http.ServerResponse[] = [];
  const application = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Length': '5' });
    response.write('hel');
    held.push(response);
    finish();
  });
  application.listen(0, '127.0.0.1');
  await once(application, 'listening');
  const address = application.address();
  const registered = await server.get('proxy.localhost', '/.well-known/node-webserver/proxy', {
    method: 'PUT',
    body: JSON.stringify({ port: address && typeof address === 'object' ? address.port : 0 }),
    headers: { Authorization: 'Bearer integration-token', 'X-Forwarded-Proto': 'https' },
  });
  expect(registered.status).toBeLessThan(300);

  return {
    received,
    release: () => held.forEach((response) => response.end('lo')),
    close: async () => {
      application.closeAllConnections();
      await new Promise((resolve) => application.close(resolve));
    },
  };
};

const refuses = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });

describeWithSignals('the server, when the process is stopped', () => {
  const servers: RunningServer[] = [];
  const cleanups: Array<() => Promise<void>> = [];

  const start = async (env: Record<string, string> = {}) => {
    const server = await startServer({ WATCH_SERVERS: 'false', ...env });
    servers.push(server);
    return server;
  };

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('answers the request in flight completely, and refuses new connections meanwhile', async () => {
    const server = await start();
    const application = await holdingApplication(server);
    cleanups.push(application.close);
    const reply = server.get('proxy.localhost');
    await application.received;

    server.signal('SIGTERM');
    await until(server, () => refuses(server.port));
    expect(server.hasExited()).toBe(false);
    application.release();

    const answered = await reply;
    expect(answered.status).toBe(200);
    expect(answered.text).toBe('hello');
    expect(answered.headers.connection).toBe('close');
    await server.exited;
  });

  it('closes an idle connection that is kept alive', async () => {
    const server = await start();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const [socket] = await new Promise<[net.Socket]>((resolve, reject) => {
      const outgoing = http.get({ host: '127.0.0.1', port: server.port, headers: { Host: 'worker.localhost' }, agent }, (response) => {
        response.resume();
        response.on('end', () => resolve([outgoing.socket as net.Socket]));
      });
      outgoing.on('error', reject);
    });
    const closed = once(socket, 'close');

    server.signal('SIGTERM');

    await closed;
    agent.destroy();
    await server.exited;
  });

  it('closes a websocket with 1001', async () => {
    const server = await start();
    const client = await connectWebSocket({ port: server.port, host: 'websocket.localhost' });
    expect(client.status).toBe(101);

    server.signal('SIGTERM');

    const message = await client.next();
    expect(message.opcode).toBe(8);
    expect(message.payload.readUInt16BE(0)).toBe(1001);
    await client.closed;
    await server.exited;
  });

  it('cuts a request that outlasts the timeout', async () => {
    const server = await start({ SHUTDOWN_TIMEOUT: '500' });
    const application = await holdingApplication(server);
    cleanups.push(application.close);
    const reply = server.get('proxy.localhost');
    const failed = expect(reply).rejects.toThrow();
    await application.received;

    server.signal('SIGTERM');

    await failed;
    await server.exited;
  });

  it('ends at once on a second signal', async () => {
    const server = await start({ SHUTDOWN_TIMEOUT: '600000' });
    const application = await holdingApplication(server);
    cleanups.push(application.close);
    const failed = expect(server.get('proxy.localhost')).rejects.toThrow();
    await application.received;

    server.signal('SIGTERM');
    await until(server, () => refuses(server.port));
    expect(server.hasExited()).toBe(false);
    server.signal('SIGTERM');

    await server.exited;
    await failed;
  });
});
