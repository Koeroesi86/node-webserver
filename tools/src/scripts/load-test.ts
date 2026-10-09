import { resolve } from 'node:path';
import { defaultDuration, defaultPortHttp, defaultPortHttps } from '../constants/load-test';
import { runLoadTest } from '../utils/run-load-test';

// Starts the example server and runs the k6 scenarios against it on this machine, with the installed k6 or else the official Docker image.
//   node load-test.js [duration of the example load test, 15s]
// PORT_HTTP (8080) and PORT_HTTPS (8443) are the ports of the server. The exit code is 1 when a threshold failed, 2 when there is no k6 and no Docker.
// Needs `pnpm build` first, `pnpm load-test` in the root does both.

const [duration = defaultDuration] = process.argv.slice(2);

runLoadTest({
  // tools/dist/scripts -> the root of the repository
  root: resolve(__dirname, '../../..'),
  duration,
  portHttp: process.env.PORT_HTTP ?? defaultPortHttp,
  portHttps: process.env.PORT_HTTPS ?? defaultPortHttps,
})
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
