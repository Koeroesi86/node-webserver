import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ComparisonOptions, ComparisonResult } from '../types/comparison';
import type { RunningProcess } from '../types/server';
import { compareFiles } from './compare-files';
import { readRequestRate } from './read-request-rate';
import { startProcess } from './start-process';
import { stopProcess } from './stop-process';
import { waitForServer } from './wait-for-server';

/**
 * Runs the load test against the base of a pull request and against the pull request itself, one after the other on this machine, and compares them.
 * Both sides get the load test (the k6 scripts, example.ts and then cpu.ts on its own, as it needs the cores) of the pull request, and their own server, which is started for every run and stopped after it:
 * two servers at the same time would take the cores from each other. Which side goes first changes with every round, so that a slow stretch of the
 * machine does not always hit the same side. The prefixes (for example `taskset -c 0-2`) are put in front of the commands of the server and of k6.
 */
export const compareWithBase = async (options: ComparisonOptions): Promise<ComparisonResult> => {
  const { base, head, rounds, duration, cpuDuration, resultsDirectory, portHttp, portHttps, serverPrefix, k6Prefix } = options;
  const [k6Script, cpuScript] = ['example.ts', 'cpu.ts'].map((name) => join(head, 'tools/src/k6', name));
  const certificates = 'packages/node-webserver/.certificates/localhost';
  let running: RunningProcess | undefined;

  mkdirSync(resultsDirectory, { recursive: true });
  readdirSync(resultsDirectory)
    .filter((name) => /\.(json|log)$/.test(name))
    .forEach((name) => rmSync(join(resultsDirectory, name)));

  // the certificate for the secure route is made for the pull request, the base serves it as well
  if (existsSync(join(head, certificates)) && !existsSync(join(base, certificates)))
    cpSync(join(head, certificates), join(base, certificates), { recursive: true });

  const k6 = (args: string[], logPath: string) => startProcess([...k6Prefix, 'k6', 'run', '--quiet', ...args], logPath).exited;

  const runSide = async (side: string, directory: string, round: number) => {
    const name = `${side}-${round}`;
    running = startProcess([...serverPrefix, 'node', 'dist/scripts/load-test-server.js'], join(resultsDirectory, `server-${name}.log`), {
      cwd: join(directory, 'packages/node-webserver'),
      env: { ...process.env, PORT_HTTP: portHttp, PORT_HTTPS: portHttps },
    });
    await waitForServer(portHttp);
    // the thresholds are those of the pull request and mean nothing for the base, only the numbers are used, so the exit code of k6 does not matter
    await k6(
      [
        `--summary-export=${join(resultsDirectory, `${name}.json`)}`,
        '-e',
        `BASE_URL=http://localhost:${portHttp}`,
        '-e',
        `HTTPS_PORT=${portHttps}`,
        '-e',
        `DURATION=${duration}`,
        '-e',
        'MIN_REQUEST_RATE=1',
        k6Script,
      ],
      join(resultsDirectory, `k6-${name}.log`)
    );
    // a fixed arrival rate, so the latency of the workers shows and does not depend on how fast the rest of the server is, the thresholds are not used here either
    await k6(
      [
        `--summary-export=${join(resultsDirectory, `cpu-${name}.json`)}`,
        '-e',
        `BASE_URL=http://localhost:${portHttp}`,
        '-e',
        `DURATION=${cpuDuration}`,
        cpuScript,
      ],
      join(resultsDirectory, `k6-cpu-${name}.log`)
    );
    console.error(`${side} ${round}: ${readRequestRate(join(resultsDirectory, `${name}.json`))}`);
    await stopProcess(running);
    running = undefined;
  };

  const sides = [
    { side: 'base', directory: base },
    { side: 'head', directory: head },
  ];
  // which side goes first changes with every round
  const steps = Array.from({ length: rounds }, (_, index) => index + 1).flatMap((round) =>
    (round % 2 === 1 ? sides : [...sides].reverse()).map((step) => ({ ...step, round }))
  );

  const interrupt = () => {
    (running === undefined ? Promise.resolve() : stopProcess(running)).finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    for (const { side, directory, round } of steps) await runSide(side, directory, round);
  } finally {
    if (running !== undefined) await stopProcess(running);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }

  const files = (prefix: string, side: string) => Array.from({ length: rounds }, (_, index) => join(resultsDirectory, `${prefix}${side}-${index + 1}.json`));

  return compareFiles({ base: files('', 'base'), head: files('', 'head'), baseCpu: files('cpu-', 'base'), headCpu: files('cpu-', 'head') });
};
