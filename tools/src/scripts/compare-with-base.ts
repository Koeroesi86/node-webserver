import { resolve } from 'node:path';
import { defaultBinaryDuration, defaultCpuDuration, defaultDuration, defaultPortHttp, defaultPortHttps, defaultRounds } from '../constants/load-test';
import { compareWithBase } from '../utils/compare-with-base';

// Runs the load test against the base of a pull request and against the pull request itself, one after the other, and compares them.
//   node compare-with-base.js <checkout of the base> <checkout of the pull request> [runs of each side, 3] [duration of a run, 15s] [duration of the CPU bound run, 10s] [duration of the binary run, 10s]
// SERVER_PREFIX and K6_PREFIX (for example `taskset -c 0-2`) are put in front of the commands, words are split on purpose.
// PORT_HTTP (8080) and PORT_HTTPS (8443) are the ports of the servers, the limits are those of compare.js.
// The results are written to compare-results/ of the current folder, the markdown of the comparison goes to stdout, the exit code is 1 on a regression.

const words = (value: string | undefined) => value?.split(/\s+/).filter(Boolean) ?? [];

const [base, head, rounds = String(defaultRounds), duration = defaultDuration, cpuDuration = defaultCpuDuration, binaryDuration = defaultBinaryDuration] =
  process.argv.slice(2);

if (base === undefined || head === undefined) {
  console.error(
    'Usage: compare-with-base.js <checkout of the base> <checkout of the pull request> [runs of each side, 3] [duration of a run, 15s] [duration of the CPU bound run, 10s] [duration of the binary run, 10s]'
  );
  process.exit(2);
}

compareWithBase({
  base: resolve(base),
  head: resolve(head),
  rounds: Number(rounds),
  duration,
  cpuDuration,
  binaryDuration,
  resultsDirectory: resolve('compare-results'),
  portHttp: process.env.PORT_HTTP ?? defaultPortHttp,
  portHttps: process.env.PORT_HTTPS ?? defaultPortHttps,
  serverPrefix: words(process.env.SERVER_PREFIX),
  k6Prefix: words(process.env.K6_PREFIX),
})
  .then(({ markdown, passed }) => {
    console.log(markdown);
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
