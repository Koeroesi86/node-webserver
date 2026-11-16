// throwaway spike for #296: does `reusePort` listen, balance and scale on this platform, compared with the fallbacks (cluster with round-robin, cluster with
// the os spreading the connections, one process)? Run on Linux, Windows and macOS by .github/workflows/spike-reuse-port.yml, the numbers are informational
// (shared runners with few cores, the load generator on the same machine).
import cluster from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import { fork, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [role, ...args] = process.argv.slice(2);
const file = fileURLToPath(import.meta.url);
const host = '127.0.0.1';
const seconds = Number(process.env.SPIKE_SECONDS ?? 5);
const fronts = Math.max(2, Math.min(4, os.availableParallelism()));

const burn = () => {
  let sum = 0;
  for (let index = 0; index < 30000; index++) {
    sum += Math.sqrt(index);
  }
  return sum;
};

const startServer = (port, reusePort) =>
  new Promise((resolve, reject) => {
    // some work per request, so that the server and not the load generator is the limit
    const server = http.createServer((request, response) => (burn(), response.end(`${process.pid}`)));
    server.once('error', reject);
    server.listen({ port, reusePort }, () => resolve(server));
  });

const request = (agent, port) =>
  new Promise((resolve) => {
    http
      .get({ host, port, agent }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve(body));
      })
      .on('error', () => resolve(undefined));
  });

const count = (counts, pid) => (pid === undefined ? counts.set('errors', (counts.get('errors') ?? 0) + 1) : counts.set(pid, (counts.get(pid) ?? 0) + 1));

const worker = (isDone, agent, port, counts) =>
  (async () => {
    while (!isDone()) {
      count(counts, await request(agent, port));
    }
  })();

const runLoad = async (port, connections) => {
  const fresh = new Map();
  let left = 400;
  await Promise.all(Array.from({ length: 16 }, () => worker(() => left-- <= 0, new http.Agent({ keepAlive: false }), port, fresh)));
  const kept = new Map();
  const end = Date.now() + seconds * 1000;
  const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
  await Promise.all(Array.from({ length: connections }, () => worker(() => Date.now() >= end, agent, port, kept)));
  agent.destroy();
  return { fresh: [...fresh], kept: [...kept] };
};

const roles = {
  'reuseport-child': async (port) => {
    process.on('disconnect', () => process.exit(0));
    await startServer(Number(port), true).then(
      () => process.send({ ok: true }),
      (error) => process.send({ error: error.code ?? error.message }),
    );
  },
  'cluster-worker': (port) => startServer(Number(port), false),
  loadgen: async (port, connections) => console.log(JSON.stringify(await runLoad(Number(port), Number(connections)))),
  'server-set': async (mode, size, port) => {
    const listening = {
      single: () => startServer(Number(port), false),
      reuseport: () =>
        Promise.all(
          Array.from({ length: Number(size) }, () => {
            const child = fork(file, ['reuseport-child', port]);
            return new Promise((resolve, reject) => {
              child.once('message', (message) => (message.error ? reject(new Error(message.error)) : resolve()));
              child.once('exit', () => reject(new Error('exited')));
            });
          }),
        ),
      cluster: () => {
        cluster.schedulingPolicy = mode === 'cluster-rr' ? cluster.SCHED_RR : cluster.SCHED_NONE;
        cluster.setupPrimary({ exec: file, args: ['cluster-worker', port] });
        const ready = new Promise((resolve) => {
          let up = 0;
          cluster.on('listening', () => ++up === Number(size) && resolve());
        });
        Array.from({ length: Number(size) }, () => cluster.fork());
        return ready;
      },
    };
    const start = listening[mode.startsWith('cluster') ? 'cluster' : mode];
    await start().then(
      () => console.log('READY'),
      (error) => {
        console.log(`FAIL ${error.code ?? error.message}`);
        process.exit(1);
      },
    );
  },
};

const waitFor = (child) =>
  new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (data) => {
      out += data;
      out.split('\n').filter((line) => /^(READY|FAIL)/.test(line)).slice(0, 1).forEach(resolve);
    });
    child.once('exit', (code) => resolve(`FAIL exited ${code}`));
    setTimeout(() => resolve('FAIL timeout'), 20000).unref();
  });

const generate = (port, connections) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file, 'loadgen', `${port}`, `${connections}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (data) => (out += data));
    child.once('exit', () => resolve(JSON.parse(out)));
  });

const stop = (child) =>
  new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
    setTimeout(resolve, 5000).unref();
  });

const merge = (parts) => parts.reduce((all, part) => part.reduce((sum, [pid, hits]) => sum.set(pid, (sum.get(pid) ?? 0) + hits), all), new Map());
const spread = (counts) => `${[...counts.keys()].filter((pid) => pid !== 'errors').length} pids: ${[...counts].map(([pid, hits]) => `${hits}${pid === 'errors' ? ' errors' : ''}`).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).join(' / ')}`;

const experiment = async ([mode, size], index) => {
  const port = 18080 + index;
  const set = spawn(process.execPath, [file, 'server-set', mode, `${size}`, `${port}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const status = await waitFor(set);
  if (status !== 'READY') {
    await stop(set);
    return `| ${mode} | ${size} | **${status}** | | | |`;
  }
  const loads = await Promise.all([generate(port, 32), generate(port, 32)]);
  await stop(set);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const fresh = merge(loads.map((load) => load.fresh));
  const kept = merge(loads.map((load) => load.kept));
  const requests = [...kept.values()].reduce((sum, hits) => sum + hits, 0);
  return `| ${mode} | ${size} | listens | ${spread(fresh)} | ${spread(kept)} | ${Math.round(requests / seconds)} |`;
};

const main = async () => {
  const rows = [];
  for (const [index, entry] of [['single', 1], ['reuseport', fronts], ['cluster-rr', fronts], ['cluster-none', fronts]].entries()) {
    rows.push(await experiment(entry, index));
  }
  const report = [
    `### reusePort spike on ${process.platform} ${process.arch}, Node ${process.version}, ${os.availableParallelism()} cores, ${os.release()}`,
    '',
    `${fronts} fronts, ${seconds} s of keep-alive load from two load generator processes on the same machine (informational).`,
    '"new connections" = 2 x 400 requests on fresh connections, "keep-alive" = how the requests of 64 long lived connections were spread.',
    '',
    '| mode | fronts | result | new connections | keep-alive | req/s |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  console.log(report);
  process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
};

const run = roles[role] ?? main;
await run(...args);
