import { createHash, randomBytes } from 'crypto';
import { once } from 'events';
import http from 'http';
import net from 'net';
import os from 'os';
import { until } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import { connectWebSocket } from './helpers/websocket-client';
import type { RunningServer } from './helpers/start-server';

// a single core runs one front, whatever is asked for
const describeWithCores = os.availableParallelism() < 2 ? describe.skip : describe;
// a signal cannot be sent to a group of processes, nor handled, on Windows
const itWithSignals = process.platform === 'win32' ? it.skip : it;

const MIB = 1024 * 1024;

interface Processes {
  worker: number;
  front: number;
}

const isAlive = (pid: number) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
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

/** the processes that answer a few requests, each on a connection of its own, without the ones that fail, as on a connection that a front had when it was killed */
const answering = async (server: RunningServer) => {
  const replies = await Promise.allSettled(Array.from({ length: 8 }, () => server.get('front.localhost', '/')));

  return replies.flatMap((reply) => (reply.status === 'fulfilled' && reply.value.status === 200 ? [reply.value.json() as Processes] : []));
};

const frontsOf = (processes: Processes[]) => Array.from(new Set(processes.map(({ front }) => front)));

/** a request that stays open, so that the connection is not closed after it, on an agent of its own */
const keepAlive = (server: RunningServer, host: string, options: http.RequestOptions = {}, body?: Buffer) => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  return new Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: Buffer; agent: http.Agent }>((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port: server.port, headers: { Host: host }, agent, ...options }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts), agent }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
};

/** a request that the server is answering, with what it answers in the end */
const inFlight = (server: RunningServer, host: string, path: string) =>
  new Promise<{ finished: Promise<string> }>((resolve, reject) => {
    const outgoing = http.get({ host: '127.0.0.1', port: server.port, path, headers: { Host: host }, agent: false }, (response) => {
      let text = '';
      const finished = new Promise<string>((done, fail) => {
        response.on('end', () => done(text));
        response.on('error', fail);
      });
      response.on('data', (part: Buffer) => (text += part));
      response.once('data', () => resolve({ finished }));
    });
    outgoing.on('error', reject);
  });

/** what the server answered on a new connection until it was closed */
const answerUntilClosed = async (port: number) => {
  const socket = net.connect(port, '127.0.0.1');
  let answer = '';
  socket.on('data', (data: Buffer) => (answer += data));
  // a connection that is dropped can be reset, which `once` of events would reject for
  socket.on('error', () => {});
  socket.write('GET / HTTP/1.1\r\nHost: front.localhost\r\n\r\n');
  await new Promise((resolve) => socket.once('close', resolve));

  return answer;
};

describeWithCores('the server with several front processes', () => {
  const servers: RunningServer[] = [];
  const cleanups: Array<() => Promise<unknown> | void> = [];

  const start = async (env: Record<string, string> = {}, options: Parameters<typeof startServer>[1] = {}) => {
    const server = await startServer({ FRONT_PROCESSES: '2', WATCH_SERVERS: 'false', ...env }, options);
    servers.push(server);
    return server;
  };

  /** all the processes of the fronts and of their workers that answered, once both fronts did */
  const processesOf = async (server: RunningServer) => {
    let seen: Processes[] = [];
    await until(server, async () => {
      seen = [...seen, ...(await answering(server))];
      return frontsOf(seen).length === 2;
    });

    return Array.from(new Set(seen.flatMap(({ worker, front }) => [worker, front])));
  };

  const gone = (server: RunningServer, pids: number[]) => until(server, () => !pids.some(isAlive));

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('answers requests with more than one front', async () => {
    const server = await start();

    expect(await processesOf(server)).not.toContain(undefined);
    expect(server.output()).toContain('[front-1]');
  });

  it('replaces a front that is killed, while the other one keeps serving', async () => {
    const server = await start({ SYSTEM_LOGS: 'true' });
    await processesOf(server);
    const [killed, other] = frontsOf(await answering(server));

    process.kill(killed, 'SIGKILL');
    let fronts: number[] = [];
    await until(server, async () => {
      fronts = frontsOf(await answering(server));
      return fronts.length === 2 && !fronts.includes(killed);
    });

    expect(fronts).toContain(other);
    expect(server.output()).toContain('another one is started');
  });

  itWithSignals('has another front answer a connection that was handed to a front which ended before it took it', async () => {
    const server = await start();
    await processesOf(server);
    const [stopped] = frontsOf(await answering(server));

    // takes nothing from the primary any more, as a front that is about to die
    process.kill(stopped, 'SIGSTOP');
    let answered = 0;
    const replies = Array.from({ length: 4 }, async () => {
      const { status } = await server.get('front.localhost', '/', { signal: AbortSignal.timeout(10000) });
      answered += 1;
      return status;
    });
    // the one that is missing was handed to the stopped front
    await until(server, () => answered === 3);
    process.kill(stopped, 'SIGKILL');

    expect(await Promise.all(replies)).toEqual([200, 200, 200, 200]);
  });

  it('closes the connections over the limit of the fronts, while the primary stays idle', async () => {
    // one connection for each front
    const server = await start({ MAX_CONNECTIONS: '2' });
    const held: Array<Awaited<ReturnType<typeof keepAlive>>> = [];
    // a connection of the start of the server may still count for a moment
    await until(server, async () => {
      const reply = await keepAlive(server, 'front.localhost').catch(() => undefined);
      held.push(...(reply ? [reply] : []));
      return held.length === 2;
    });
    cleanups.push(() => held.forEach(({ agent }) => agent.destroy()));

    const before = await server.cpuTime();
    const answers = await Promise.all([answerUntilClosed(server.port), answerUntilClosed(server.port)]);
    // the window the processor time is measured over: a primary that hands a connection from front to front takes all of it
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const used = (await server.cpuTime()) - before;

    expect(answers).toEqual(['', '']);
    expect(used).toBeLessThan(500);
  });

  it('has every front pass the requests on to the target registered with one of them, a front that replaces another one too', async () => {
    const upstream = http.createServer((_, response) => response.end('upstream'));
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    cleanups.push(() => new Promise((resolve) => upstream.close(resolve)));
    const { port } = upstream.address() as net.AddressInfo;
    const server = await start({ SYSTEM_LOGS: 'true' });
    await processesOf(server);
    /** what requests on connections of their own are answered with, enough of them for every front to get some */
    const statuses = async () => {
      const replies = await Promise.all(Array.from({ length: 8 }, () => server.get('proxy.localhost', '/', { signal: AbortSignal.timeout(5000) })));
      upstream.closeIdleConnections();
      return Array.from(new Set(replies.map(({ status }) => status)));
    };
    const control = (method: string, body?: object) =>
      server.get('proxy.localhost', '/.well-known/node-webserver/proxy', {
        method,
        body: body && JSON.stringify(body),
        headers: { Authorization: 'Bearer integration-token', 'X-Forwarded-Proto': 'https' },
      });
    expect(await statuses()).toEqual([503]);

    expect((await control('PUT', { port })).status).toBe(200);
    // at once, as the answer is only given once every front was told
    expect(await statuses()).toEqual([200]);

    const [killed] = frontsOf(await answering(server));
    process.kill(killed, 'SIGKILL');
    await until(server, async () => {
      const fronts = frontsOf(await answering(server));
      return fronts.length === 2 && !fronts.includes(killed);
    });
    expect(await statuses()).toEqual([200]);

    expect((await control('DELETE')).status).toBe(204);
    expect(await statuses()).toEqual([503]);
  });

  it('has every front pass the requests of a child server on to the one application that the primary started, which ends with the server', async () => {
    const server = await start({ SYSTEM_LOGS: 'true' });
    await processesOf(server);
    /** the applications that requests on connections of their own reach, enough of them for every front to get some */
    const applications = async () => {
      const replies = await Promise.all(Array.from({ length: 8 }, () => server.get('child.localhost', '/', { signal: AbortSignal.timeout(5000) })));
      return Array.from(new Set(replies.map((reply) => (reply.status === 200 ? (reply.json() as { pid: number }).pid : reply.status))));
    };
    // the application may not listen yet
    await until(server, async () => !(await applications()).includes(502));
    const [application, ...others] = await applications();
    expect(others).toEqual([]);

    const [killed] = frontsOf(await answering(server));
    process.kill(killed, 'SIGKILL');
    await until(server, async () => {
      const fronts = frontsOf(await answering(server));
      return fronts.length === 2 && !fronts.includes(killed);
    });
    expect(await applications()).toEqual([application]);

    await server.stop();
    await until(server, () => !isAlive(application));
  });

  it('tells a worker the metrics of every front, labelled, with the ones of its own front on top', async () => {
    const server = await start();
    await processesOf(server);

    const reply = await server.get('health.localhost', '/metrics');
    const metrics = reply.json() as { front: number; uptimeSeconds: number; fronts: Record<string, { uptimeSeconds: number; sources: object }> };

    expect(Object.keys(metrics.fronts)).toEqual(['1', '2']);
    expect(metrics.uptimeSeconds).toBe(metrics.fronts[metrics.front].uptimeSeconds);
    Object.values(metrics.fronts).forEach(({ sources }) => expect(sources).toHaveProperty(['workers:health.localhost']));
  });

  it('loads the servers again in every front', async () => {
    const server = await start({ SYSTEM_LOGS: 'true' });

    server.reload();

    await until(server, () => ['[front-1]', '[front-2]'].every((front) => new RegExp(`\\${front}.*Servers loaded again`).test(server.output())));
  });

  itWithSignals('loads the servers again once, in every front, on a SIGHUP that reaches every process, also without watching files', async () => {
    const server = await start({ SYSTEM_LOGS: 'true', RELOAD_ON_SIGHUP: 'true' }, { ownGroup: true });

    server.signalAll('SIGHUP');

    await until(server, () => server.output().includes('The servers were loaded again in 2 fronts'));
    expect(await answering(server)).not.toHaveLength(0);
    expect(server.output().split('The servers were loaded again')).toHaveLength(2);
  });

  it('hands big responses and request bodies over to the workers', async () => {
    const server = await start();
    const upload = randomBytes(2 * MIB);

    const downloaded = await keepAlive(server, 'download.localhost', { path: '/?mib=4' });
    const uploaded = await keepAlive(
      server,
      'upload.localhost',
      { method: 'POST', headers: { Host: 'upload.localhost', 'Content-Length': upload.length } },
      upload
    );
    cleanups.push(() => [downloaded, uploaded].forEach(({ agent }) => agent.destroy()));

    // a connection that was handed over is closed after the response
    expect([downloaded.headers.connection, uploaded.headers.connection]).toEqual(['close', 'close']);
    expect(downloaded.body.length).toBe(4 * MIB);
    expect(JSON.parse(uploaded.body.toString())).toEqual({ size: upload.length, sha256: createHash('sha256').update(upload).digest('hex') });
  });

  it('finishes the requests in flight when it is stopped, closes websockets with 1001 and leaves no process behind', async () => {
    const server = await start();
    const processes = await processesOf(server);
    const client = await connectWebSocket({ port: server.port, host: 'websocket.localhost' });
    client.send('hello');
    expect((await client.next()).payload.toString()).toBe('hello');
    const request = await inFlight(server, 'front.localhost', '/?wait=2000');

    // the signal goes to the primary alone, on Windows it cannot be sent
    if (process.platform === 'win32') server.requestStop();
    else server.signal('SIGTERM');

    const message = await client.next();
    expect([message.opcode, message.payload.readUInt16BE(0)]).toEqual([8, 1001]);
    await until(server, () => refuses(server.port));
    expect(await request.finished).toBe('started\nfinished\n');
    await server.exited;
    await gone(server, processes);
  });

  itWithSignals('takes the signal of a service stop, which reaches every process, as one', async () => {
    // the application is not a process of the server, so the signal does not reach it, unlike a worker
    const held: http.ServerResponse[] = [];
    const application = http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Length': '5' });
      response.write('hel');
      held.push(response);
    });
    application.listen(0, '127.0.0.1');
    await once(application, 'listening');
    cleanups.push(() => application.closeAllConnections());
    cleanups.push(() => new Promise((resolve) => application.close(resolve)));
    const address = application.address() as net.AddressInfo;
    const server = await start({ PORT_CLOSED: `${address.port}` }, { ownGroup: true });
    const processes = await processesOf(server);
    const request = await inFlight(server, 'proxy-down.localhost', '/');

    server.signalAll('SIGTERM');
    await until(server, () => refuses(server.port));
    expect(server.hasExited()).toBe(false);
    held.forEach((response) => response.end('lo'));

    expect(await request.finished).toBe('hello');
    await server.exited;
    await gone(server, processes);
  });

  it('takes the fronts, their workers and the application of a child server with it when the primary is killed', async () => {
    const server = await start();
    const processes = await processesOf(server);
    let application = 0;
    await until(server, async () => {
      const reply = await server.get('child.localhost', '/', { signal: AbortSignal.timeout(5000) });
      application = reply.status === 200 ? (reply.json() as { pid: number }).pid : 0;
      return application > 0;
    });

    server.signal('SIGKILL');

    await server.exited;
    await gone(server, [...processes, application]);
  });

  it('does not start, and says why, when a front cannot listen', async () => {
    const taken = net.createServer().listen(0);
    await once(taken, 'listening');
    cleanups.push(() => new Promise((resolve) => taken.close(resolve)));
    const { port } = taken.address() as net.AddressInfo;

    await expect(start({ PORT_HTTPS: `${port}` })).rejects.toThrow(/Front [12] did not start: .*EADDRINUSE/);
  });
});
