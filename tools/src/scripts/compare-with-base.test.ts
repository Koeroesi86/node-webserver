import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createCheckout, installFakeK6 } from '../test-helpers/fake-load-test';

const script = resolve(__dirname, '../../dist/scripts/compare-with-base.js');

describe('compare-with-base script', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'compare-with-base-script-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const isAlive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitFor = async (condition: () => boolean): Promise<void> => {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 50));

    return waitFor(condition);
  };

  it('explains the usage and fails without the two checkouts', () => {
    const result = spawnSync('node', [script], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: compare-with-base.js');
  });

  it('stops the server and k6 when it is interrupted, and exits with 130', async () => {
    const [base, head] = [createCheckout(folder, 'base', 4000), createCheckout(folder, 'head', 4000)];
    const files = { pid: join(folder, 'k6.pid'), started: join(folder, 'k6.started') };
    const child = spawn('node', [script, base, head, '1', '1s', '1s'], {
      cwd: folder,
      env: {
        PATH: `${installFakeK6(folder)}${delimiter}${process.env.PATH}`,
        PORT_HTTP: '18483',
        FAKE_K6_SLEEP: '1',
        FAKE_K6_PID: files.pid,
        FAKE_K6_STARTED: files.started,
        FAKE_K6_LOG: join(folder, 'k6.log'),
      },
      stdio: 'ignore',
    });
    const closed = new Promise<number | null>((done) => child.on('close', done));
    // the first side to run is the base, k6 runs against its server
    await waitFor(() => existsSync(files.started));
    const [serverPid, k6Pid] = [Number(readFileSync(join(base, 'server.pid'), 'utf8')), Number(readFileSync(files.pid, 'utf8'))];

    child.kill('SIGINT');

    expect(await closed).toBe(130);
    expect(isAlive(serverPid)).toBe(false);
    expect(isAlive(k6Pid)).toBe(false);
    // it did not go on with the other side
    expect(existsSync(join(head, 'server.pid'))).toBe(false);
  }, 30000);
});
