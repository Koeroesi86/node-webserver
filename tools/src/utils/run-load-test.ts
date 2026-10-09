import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { k6Image } from '../constants/load-test';
import type { LoadTestOptions } from '../types/k6';
import { buildK6Command } from './build-k6-command';
import { chooseK6Runner } from './choose-k6-runner';
import { makeCertificate } from './make-certificate';
import { startProcess } from './start-process';
import { stopProcess } from './stop-process';
import { waitForServer } from './wait-for-server';
import { warmUpServer } from './warm-up-server';

/** runs the command with its output on this terminal, resolves with its exit code */
const runVisible = ([command, ...args]: string[]) =>
  new Promise<number>((done) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env } });
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', (error) => {
      console.error(`${command} could not be started: ${error.message}`);
      done(1);
    });
  });

/**
 * Starts the example server, warms it up and runs the scenarios of the workflow against it (the example load test, then the CPU bound one on its own),
 * with the installed k6 or else the official Docker image. Resolves with the exit code: 0 when the thresholds of both held.
 */
export const runLoadTest = async ({ root, duration, portHttp, portHttps, runner = chooseK6Runner() }: LoadTestOptions) => {
  if (runner === undefined) {
    console.error('k6 is not installed and neither is Docker. Install k6 (see tools/README.md#run-locally) or Docker.');

    return 2;
  }

  const secure = makeCertificate(join(root, 'packages/node-webserver/.certificates/localhost'));
  if (!secure) console.error('openssl is not available, so the HTTPS and secure websocket routes are left out.');

  const logPath = join(mkdtempSync(join(tmpdir(), 'load-test-')), 'server.log');
  const server = startProcess(['node', 'dist/scripts/load-test-server.js'], logPath, {
    cwd: join(root, 'packages/node-webserver'),
    env: { PORT_HTTP: portHttp, PORT_HTTPS: portHttps },
  });
  const interrupt = () => {
    stopProcess(server).finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    console.error(`k6: ${runner === 'native' ? 'installed' : `Docker (${k6Image})`}, the log of the server is ${logPath}`);
    await waitForServer(portHttp);
    await warmUpServer(portHttp);

    const scenario = (script: string, args: string[]) =>
      runVisible(
        buildK6Command({
          runner,
          scriptsDirectory: join(root, 'tools/src/k6'),
          script,
          args: ['-e', `BASE_URL=http://localhost:${portHttp}`, ...args],
          image: k6Image,
        })
      );
    const example = await scenario('example.ts', ['-e', `DURATION=${duration}`, ...(secure ? ['-e', `HTTPS_PORT=${portHttps}`] : [])]);
    // on its own, as other traffic would take the cores that its workers need
    const cpu = await scenario('cpu.ts', []);

    return example === 0 && cpu === 0 ? 0 : 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await stopProcess(server);
  }
};
