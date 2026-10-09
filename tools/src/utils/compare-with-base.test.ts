import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createCheckout, fakeK6Prefix, installFakeK6 } from '../test-helpers/fake-load-test';
import type { ComparisonOptions } from '../types/comparison';
import { compareWithBase } from './compare-with-base';

describe('compareWithBase', () => {
  let folder = '';
  let bin = '';
  const savedPath = process.env.PATH;

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'compare-with-base-'));
    bin = installFakeK6(folder);
    process.env.PATH = `${bin}${delimiter}${savedPath}`;
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    rmSync(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.FAKE_K6_FAIL;
    process.env.FAKE_K6_LOG = join(folder, 'k6.log');
    writeFileSync(process.env.FAKE_K6_LOG, '');
  });

  const checkout = (side: string, rate: number) => createCheckout(folder, side, rate);

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
    k6Prefix: fakeK6Prefix(bin),
    ...more,
  });

  const k6Calls = () => readFileSync(join(folder, 'k6.log'), 'utf8').trim().split('\n');

  it('runs every side with its own server, alternating, and passes when both are as fast', async () => {
    const result = await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { k6Prefix: ['env', 'PREFIXED=yes', ...fakeK6Prefix(bin)] }));

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

  it('warms the server up before k6 measures, with the endpoints that start workers', async () => {
    const [base, head] = [checkout('base', 4000), checkout('head', 4000)];
    await compareWithBase(options(base, head, { rounds: 1 }));

    [base, head].forEach((directory) => {
      const requests = readFileSync(join(directory, 'requests.log'), 'utf8').split('\n');

      expect(requests).toContain('lambda.localhost GET /index.html');
      expect(requests).toContain('upload.localhost POST /');
      expect(requests).toContain('health.localhost GET /health');
      // the first request is the one that waits for the server, the fake k6 asks for the side afterwards
      expect(requests.filter((request) => request.startsWith('lambda.localhost'))).toHaveLength(21);
    });
  }, 30000);

  it('tells about a route that only the pull request serves, and still passes', async () => {
    const [base, head] = [checkout('base', 4000), checkout('head', 4000)];
    writeFileSync(join(base, 'missing.txt'), '/binary/?size=1\n');
    const result = await compareWithBase(options(base, head, { rounds: 1 }));

    expect(result.passed).toBe(true);
    expect(result.markdown).toContain('Not served alike');
    expect(result.markdown).toContain('- `web.localhost/binary/?size=1`: 404 on the base, 200 on the pull request');
  }, 30000);

  it('says nothing about the routes when both sides serve alike', async () => {
    const result = await compareWithBase(options(checkout('base', 4000), checkout('head', 4000), { rounds: 1 }));

    expect(result.markdown).not.toContain('Not served alike');
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
