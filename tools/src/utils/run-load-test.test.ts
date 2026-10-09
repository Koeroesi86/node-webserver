import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createCheckout } from '../test-helpers/fake-load-test';
import { runLoadTest } from './run-load-test';

// a k6 that writes its arguments to FAKE_K6_LOG, and fails for the scenario in FAKE_K6_FAIL
const fakeK6 = `#!/usr/bin/env node
const { appendFileSync } = require('fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_K6_LOG, args.join(' ') + '\\n');
process.exit(args[args.length - 1].endsWith(process.env.FAKE_K6_FAIL || 'nothing') ? 1 : 0);
`;

// a script is not started by its name on Windows
(process.platform === 'win32' ? describe.skip : describe)('runLoadTest', () => {
  let folder = '';
  const savedPath = process.env.PATH;

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'run-load-test-'));
    mkdirSync(join(folder, 'bin'));
    writeFileSync(join(folder, 'bin/k6'), fakeK6);
    chmodSync(join(folder, 'bin/k6'), 0o755);
    process.env.PATH = `${join(folder, 'bin')}${delimiter}${savedPath}`;
    process.env.FAKE_K6_LOG = join(folder, 'k6.log');
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    rmSync(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.FAKE_K6_FAIL;
    writeFileSync(process.env.FAKE_K6_LOG as string, '');
  });

  const run = (duration = '2s') => runLoadTest({ root: createCheckout(folder, 'head', 1), duration, portHttp: '18491', portHttps: '18454', runner: 'native' });
  const calls = () => readFileSync(join(folder, 'k6.log'), 'utf8').trim().split('\n');

  it('runs the example scenario, the CPU bound one and the binary one against the server, and passes when all do', async () => {
    expect(await run()).toBe(0);

    const [example, cpu, binary] = calls();
    expect(example).toMatch(/^run -e BASE_URL=http:\/\/localhost:18491 -e DURATION=2s( -e HTTPS_PORT=18454)? .*example\.ts$/);
    expect(cpu).toMatch(/^run -e BASE_URL=http:\/\/localhost:18491 .*cpu\.ts$/);
    expect(binary).toMatch(/^run -e BASE_URL=http:\/\/localhost:18491 .*binary\.ts$/);
  });

  it('fails when a scenario does, and still runs the others', async () => {
    process.env.FAKE_K6_FAIL = 'example.ts';

    expect(await run()).toBe(1);
    expect(calls()).toHaveLength(3);
  });

  it('is 2 when neither k6 nor Docker can be used', async () => {
    process.env.PATH = '';
    const code = await runLoadTest({ root: folder, duration: '2s', portHttp: '18491', portHttps: '18454' });
    process.env.PATH = `${join(folder, 'bin')}${delimiter}${savedPath}`;

    expect(code).toBe(2);
  });
});
