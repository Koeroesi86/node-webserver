import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ComparisonOptions } from '../types/comparison';
import { compareWithBase } from './compare-with-base';

// a server that answers with its side and the rate that the fake k6 reports for it, and a k6 that asks the server and writes a summary
const fakeServer = `
const http = require('http');
const { readFileSync } = require('fs');
const { join } = require('path');
http.createServer((request, response) => response.end(readFileSync(join(__dirname, '../../../../side.txt'), 'utf8'))).listen(Number(process.env.PORT_HTTP));
process.on('SIGTERM', () => process.exit(0));
`;
const fakeK6 = `#!/usr/bin/env node
const http = require('http');
const { appendFileSync, writeFileSync } = require('fs');
const args = process.argv.slice(2);
const exportPath = args.find((argument) => argument.startsWith('--summary-export=')).split('=')[1];
const env = Object.fromEntries(args.flatMap((argument, index) => (argument === '-e' ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : [])));
const script = args[args.length - 1];
const kind = script.endsWith('cpu.ts') ? 'cpu' : 'main';
if (!require('fs').existsSync(script)) process.exit(3);
if (process.env.FAKE_K6_FAIL) process.exit(1);
http.get(env.BASE_URL, { headers: { Host: 'web.localhost' } }, (response) => {
  let body = '';
  response.on('data', (chunk) => (body += chunk));
  response.on('end', () => {
    const [side, rate] = body.trim().split(' ');
    appendFileSync(process.env.FAKE_K6_LOG, [side, kind, env.DURATION, process.env.PREFIXED].join(' ') + '\\n');
    const metrics = kind === 'cpu' ? { 'http_req_duration{route:cpu}': { 'p(95)': 12 } } : { http_reqs: { rate: Number(rate) } };
    writeFileSync(exportPath, JSON.stringify({ metrics }));
  });
});
`;

describe('compareWithBase', () => {
  let folder = '';
  const savedPath = process.env.PATH;

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'compare-with-base-'));
    mkdirSync(join(folder, 'bin'));
    writeFileSync(join(folder, 'bin', 'k6'), fakeK6);
    chmodSync(join(folder, 'bin', 'k6'), 0o755);
    process.env.PATH = `${join(folder, 'bin')}${delimiter}${savedPath}`;
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    if (!process.env.KEEP_FOLDER) rmSync(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.FAKE_K6_FAIL;
    process.env.FAKE_K6_LOG = join(folder, 'k6.log');
    writeFileSync(process.env.FAKE_K6_LOG, '');
  });

  /** a checkout with the server of the load test, that reports the rate of its side */
  const checkout = (side: string, rate: number) => {
    const directory = join(folder, `${side}-${rate}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(directory, 'packages/node-webserver/dist/scripts'), { recursive: true });
    writeFileSync(join(directory, 'packages/node-webserver/dist/scripts/load-test-server.js'), fakeServer);
    writeFileSync(join(directory, 'side.txt'), `${side} ${rate}`);
    mkdirSync(join(directory, 'tools/src/k6'), { recursive: true });
    ['example.ts', 'cpu.ts'].forEach((name) => writeFileSync(join(directory, 'tools/src/k6', name), ''));

    return directory;
  };

  const options = (base: string, head: string, more: Partial<ComparisonOptions> = {}): ComparisonOptions => ({
    base,
    head,
    rounds: 2,
    duration: '2s',
    cpuDuration: '1s',
    resultsDirectory: join(folder, 'results'),
    portHttp: '18481',
    portHttps: '18444',
    serverPrefix: [],
    k6Prefix: [],
    ...more,
  });

  const k6Calls = () => readFileSync(join(folder, 'k6.log'), 'utf8').trim().split('\n');

  it('runs every side with its own server, alternating, and passes when both are as fast', async () => {
    const result = await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { k6Prefix: ['env', 'PREFIXED=yes'] }));

    expect(result.passed).toBe(true);
    expect(result.markdown).toContain('✅ no regression');
    expect(result.markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 4000 (4000-4000) | +0.0% | ✅ |');
    expect(result.markdown).toContain('| p95 CPU bound (ms) | 12.0 | 12.0 | +0.0% | ✅ |');
    expect(k6Calls()).toEqual([
      'base main 2s yes',
      'base cpu 1s yes',
      'head main 2s yes',
      'head cpu 1s yes',
      'head main 2s yes',
      'head cpu 1s yes',
      'base main 2s yes',
      'base cpu 1s yes',
    ]);
  }, 30000);

  it('fails when the pull request is clearly slower', async () => {
    const result = await compareWithBase(options(checkout('base', 4000), checkout('head', 2000)));

    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('❌ regression');
    expect(result.markdown).toContain('Throughput is 50.0% lower than the base');
  }, 30000);

  it('fails and says so when k6 produced no summaries', async () => {
    process.env.FAKE_K6_FAIL = '1';
    const result = await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { rounds: 1 }));

    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('No summary of the base');
  }, 30000);

  it('leaves no server running and keeps the logs of the runs', async () => {
    await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { rounds: 1 }));

    // the port is free again, so a server can be started on it
    await expect(fetch('http://localhost:18481')).rejects.toThrow();
    expect(existsSync(join(folder, 'results', 'server-base-1.log'))).toBe(true);
    expect(existsSync(join(folder, 'results', 'k6-cpu-head-1.log'))).toBe(true);
  }, 30000);

  it('removes the results of an earlier run', async () => {
    mkdirSync(join(folder, 'results'), { recursive: true });
    writeFileSync(join(folder, 'results', 'base-9.json'), '{}');
    await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { rounds: 1 }));

    expect(existsSync(join(folder, 'results', 'base-9.json'))).toBe(false);
  }, 30000);

  it('gives the base the certificate of the pull request', async () => {
    const [base, head] = [checkout('base', 4000), checkout('head', 4000)];
    mkdirSync(join(head, 'packages/node-webserver/.certificates/localhost'), { recursive: true });
    writeFileSync(join(head, 'packages/node-webserver/.certificates/localhost/cert.pem'), 'certificate');
    await compareWithBase(options(base, head, { rounds: 1 }));

    expect(readFileSync(join(base, 'packages/node-webserver/.certificates/localhost/cert.pem'), 'utf8')).toBe('certificate');
  }, 30000);
});
