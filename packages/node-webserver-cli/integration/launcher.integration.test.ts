import { spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { CLI, createServerFolder, isAlive, until } from './helpers/server-folder';
import type { Answer, ServerFolder } from './helpers/server-folder';

// signals cannot be sent to a process on Windows, which ends it at once
const itWithSignals = process.platform === 'win32' ? it.skip : it;
// a single core runs one front, whatever is asked for
const itWithCores = os.availableParallelism() < 2 ? it.skip : it;
// a change between one front and several takes a restart, other than on Windows
const itWithRestart = process.platform === 'win32' || os.availableParallelism() < 2 ? it.skip : it;

/** the command line with the configuration of the folder, which is the launcher of its server */
const launch = (folder: ServerFolder) => {
  const child = spawn(process.execPath, [CLI, '--config', folder.configurationFile], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  let ended: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stdout.on('data', (data: Buffer) => (output += data));
  child.stderr.on('data', (data: Buffer) => (output += data));
  const exited = new Promise<void>((resolve) =>
    child.once('exit', (code, signal) => {
      ended = { code, signal };
      resolve();
    })
  );

  return {
    child,
    exited,
    ended: () => ended,
    output: () => output,
    /** signals every process of the server, as systemd and Ctrl+C do. Not on Windows. */
    signalAll: (signal: NodeJS.Signals) => child.pid && process.kill(-child.pid, signal),
    describe: () => `The launcher ended with ${JSON.stringify(ended)}. The output of the server:\n${output}`,
  };
};

/** a server with an application on a port of its own, which answers with its process, like a worker does */
const childServer = (port: number, extra = '') => ({
  hostname: 'app.localhost',
  protocol: 'http',
  type: 'child',
  childOptions: {
    command: process.execPath,
    args: ['-e', "require('http').createServer((_, res) => res.end(JSON.stringify({ worker: process.pid }))).listen(+process.argv[1])", `${port}`, extra],
  },
  proxyOptions: { port },
  serverOptions: { protocol: 'http', proxyTarget: `http://localhost:${port}` },
});

/** registers the target of `proxy.localhost`, and tells what the server answered */
const register = (portHttp: number, port: number) =>
  new Promise<number | undefined>((resolve, reject) => {
    const headers = { Host: 'proxy.localhost', Authorization: 'Bearer a', 'X-Forwarded-Proto': 'https' };
    const outgoing = http.request({ host: '127.0.0.1', port: portHttp, path: '/.well-known/node-webserver/proxy', method: 'PUT', headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    outgoing.on('error', reject);
    outgoing.end(JSON.stringify({ port }));
  });

describe('the server of the command line', () => {
  let folder: ServerFolder;
  let server: ReturnType<typeof launch>;
  const cleanups: Array<() => unknown> = [];

  const eventually = (condition: () => Promise<boolean> | boolean) => until(condition, server.describe);

  const serving = async (host = 'web.localhost', status = 200) => eventually(async () => (await folder.get(host)).status === status);

  const start = async (settings: object = {}, servers: Array<object | string> = []) => {
    folder.configure(settings, servers);
    server = launch(folder);
    await eventually(() => server.output().includes('is serving'));
    await serving();
  };

  /** the fronts and the workers that answer a few requests */
  const answering = async () => (await Promise.all(Array.from({ length: 8 }, () => folder.get()))).filter(({ status }) => status === 200);
  const frontsOf = (answers: Answer[]) => Array.from(new Set(answers.map(({ front }) => front)));

  /** asks without a pause until it is stopped, and tells the statuses that were not 200 */
  const keepAsking = () => {
    let asking = true;
    const failures: number[] = [];
    const ask = async () => {
      while (asking) {
        const { status } = await folder.get();
        failures.push(...(status === 200 ? [] : [status]));
      }
    };
    const askers = Array.from({ length: 4 }, ask);

    return async () => {
      asking = false;
      await Promise.all(askers);
      return failures;
    };
  };

  /** every process of the server: the launcher, what loaded the configuration, and the workers that answer now */
  const processes = async () => {
    const workers = (await answering()).flatMap(({ worker }) => (worker ? [worker] : []));

    return [server.child.pid ?? 0, ...folder.processes(), ...workers];
  };

  const gone = (pids: number[]) => eventually(() => !pids.some(isAlive));

  /** a port that something else listens on */
  const takePort = async () => {
    const taken = net.createServer().listen(0);
    await once(taken, 'listening');
    const free = () => new Promise((resolve) => (taken.listening ? taken.close(resolve) : resolve(undefined)));
    cleanups.push(free);
    const address = taken.address() as net.AddressInfo;

    return { port: address.port, free };
  };

  beforeEach(async () => (folder = await createServerFolder()));

  afterEach(async () => {
    const pids = [server.child.pid ?? 0, ...folder.processes()];
    // the launcher takes everything it started with it
    server.child.kill('SIGKILL');
    await server.exited;
    await until(() => !pids.some(isAlive), server.describe);
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    folder.remove();
  });

  it('picks up a changed configuration without a failed request', async () => {
    await start();
    const [before] = await answering();
    const failures = keepAsking();

    folder.configure({}, [folder.server('added.localhost')]);

    await serving('added.localhost');
    await eventually(() => !isAlive(before.front ?? 0));
    expect(await failures()).toEqual([]);
    expect(frontsOf(await answering())).not.toContain(before.front);
    expect(server.ended()).toBeUndefined();
  });

  it('keeps the target that was registered with a proxy server when new fronts take over', async () => {
    const upstream = http.createServer((_, response) => response.end('upstream'));
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    cleanups.push(() => new Promise((resolve) => upstream.close(resolve)));
    const proxy = { hostname: 'proxy.localhost', protocol: 'http', type: 'proxy', proxyOptions: { dynamic: { token: 'a', allowPrivate: true } } };
    // the loopback address stands in for a load balancer that ended TLS, which the control path asks for
    const settings = { trustedProxies: ['loopback'] };
    await start(settings, [proxy]);
    const [before] = await answering();
    expect(await register(folder.portHttp, (upstream.address() as net.AddressInfo).port)).toBe(200);

    folder.configure(settings, [proxy, folder.server('added.localhost')]);

    await serving('added.localhost');
    await eventually(() => !isAlive(before.front ?? 0));
    expect((await folder.get('proxy.localhost')).status).toBe(200);
    expect(server.output()).not.toContain('The server restarts');
  });

  it('keeps the old front for a configuration that cannot be loaded, has a problem or does not start', async () => {
    await start();
    const [before] = await answering();
    const { port } = await takePort();

    folder.write('module.exports = {');
    await eventually(() => server.output().includes('The configuration could not be loaded'));
    folder.configure({ keepAliveTimeout: 'long' });
    await eventually(() => server.output().includes('keepAliveTimeout must be integer'));
    folder.configure({ portHttps: port }, [folder.server('added.localhost')]);
    await eventually(() => server.output().includes('The change was not applied'));

    expect(frontsOf(await answering())).toEqual([before.front]);
    expect((await folder.get('added.localhost')).status).toBe(421);
    // and the next one that is right is applied
    folder.configure({}, [folder.server('added.localhost')]);
    await serving('added.localhost');
  });

  it('applies a changed file that the configuration loads', async () => {
    const hosts = path.join(folder.folder, 'hosts.js');
    fs.writeFileSync(hosts, "module.exports = 'first.localhost';");
    folder.configure();
    const configuration = fs.readFileSync(folder.configurationFile, 'utf8');
    folder.write(`${configuration}\nmodule.exports.servers.push({ ...module.exports.servers[0], hostname: require('./hosts') });`);
    server = launch(folder);
    await serving('first.localhost');

    fs.writeFileSync(hosts, "module.exports = 'second.localhost';");

    await serving('second.localhost');
  });

  it('keeps the application of a child server through a change of the configuration, and starts another one for a changed server', async () => {
    const { port, free } = await takePort();
    await free();
    const application = async () => (await folder.get('app.localhost')).worker ?? 0;
    await start({}, [childServer(port)]);
    await serving('app.localhost');
    const first = await application();
    const [before] = await answering();

    folder.configure({}, [childServer(port), folder.server('added.localhost')]);
    await serving('added.localhost');
    await eventually(() => !isAlive(before.front ?? 0));
    expect(await application()).toBe(first);

    // on the same port, which the new one gets once the old one ended
    folder.configure({}, [childServer(port, 'changed')]);
    await eventually(async () => ![0, first].includes(await application()));
    expect(isAlive(first)).toBe(false);
    const second = await application();

    folder.configure();
    await eventually(() => !isAlive(second));
    expect(server.output()).not.toContain('The server restarts');
  });

  itWithCores('changes between one front and several, with a restart where the way of accepting connections changes', async () => {
    await start();

    folder.configure({ frontProcesses: 2 });

    await eventually(async () => frontsOf(await answering()).length === 2);
    // on Windows the primary accepts the connections of one front too
    expect(server.output().includes('frontProcesses changed between one front and several')).toBe(process.platform !== 'win32');
    expect(server.ended()).toBeUndefined();
  });

  itWithCores('runs another number of fronts when a limit of a server file changes it, without a restart', async () => {
    const file = path.join(folder.folder, 'limited.js');
    const write = (limit: number) =>
      fs.writeFileSync(
        file,
        `module.exports = ${JSON.stringify(folder.server('limited.localhost', { options: { root: path.join(folder.folder, 'worker'), index: ['worker.js'], limit } }))};`
      );
    write(2);
    await start({ frontProcesses: 2 }, [file]);
    await eventually(async () => frontsOf(await answering()).length === 2);

    write(1);

    await eventually(() => server.output().includes('applied with new front processes: 1'));
    await eventually(async () => frontsOf(await answering()).length === 1);
    expect(server.output()).not.toContain('The server restarts');
  });

  itWithRestart('tries again when the server does not start after a restart', async () => {
    await start();
    const { port, free } = await takePort();

    // from one front to several, which takes a restart
    folder.configure({ frontProcesses: 2, portHttps: port }, [folder.server('added.localhost')]);
    await eventually(() => server.output().includes('did not start after its restart'));
    expect(server.ended()).toBeUndefined();
    await free();

    await serving('added.localhost');
  });

  it('ends with an error when its first start fails', async () => {
    const { port } = await takePort();
    folder.configure({ portHttp: port });
    server = launch(folder);

    await server.exited;

    expect(server.ended()?.code).toBe(1);
  });

  it('leaves no process behind when the launcher is killed, the application of a child server neither', async () => {
    const { port, free } = await takePort();
    await free();
    await start({}, [childServer(port)]);
    await serving('app.localhost');
    const pids = [...(await processes()), (await folder.get('app.localhost')).worker ?? 0];

    server.child.kill('SIGKILL');

    await server.exited;
    await gone(pids);
  });

  itWithSignals.each(['SIGTERM', 'SIGINT'] as const)('stops through the launcher on %s, which it ends with, and leaves no process behind', async (signal) => {
    await start();
    const pids = await processes();

    server.child.kill(signal);

    await server.exited;
    expect(server.ended()).toEqual({ code: null, signal });
    await gone(pids);
  });

  itWithSignals('finishes the requests in flight when it is stopped through the launcher', async () => {
    await start();
    const reply = folder.get('web.localhost', '/?wait=2000');
    await eventually(folder.isWaiting);

    server.child.kill('SIGTERM');

    expect((await reply).status).toBe(200);
    await server.exited;
  });

  itWithSignals('takes a signal that reaches every process as one stop', async () => {
    await start();
    const pids = await processes();

    server.signalAll('SIGTERM');

    await server.exited;
    expect(server.output().split('stopping the fronts')).toHaveLength(2);
    await gone(pids);
  });
});
