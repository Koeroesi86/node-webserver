import crypto from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Parallel uploads of a big body with a Content-Length to web.localhost/upload/ (examples/upload/exampleWorker.js: the size and sha256 of what it received), which the server hands to the worker
// to read from the client itself (node-worker-express, `handOffRequests`), so that the bytes do not pass through the one front process. Every upload is checked by the size and the sha256 the worker
// answers with, and its speed in MB/s is a metric of its own: a front process that carries the bytes shows as uploads that get slower the more of them run at once, with a floor on the slowest tenth as the threshold.
// The uploads run twice on the same server, one mode after the other: `keep-alive` leaves the connection to the server, which the worker gives back after its response so that the client sends its next
// upload on it, and `reconnect` sends `Connection: close`, which makes the worker close it as every handed over upload did before, so the next upload opens a new connection. The metrics of both
// have the tag `mode`, and the summary of the workflow puts them side by side: that is the measure of what a reconnect costs next to a body of this size.
// REQUIRE_HANDOFF=1 also checks that the handoff and the hand back happened, which the client cannot tell by the connection alone: the counters of the metrics of the server (`handOffs.requests` at
// health.localhost/metrics) must have grown by the end of the run, the uploads of `keep-alive` must have reused their connections, and those of `reconnect` must not have. k6 does not show the header in `headers`,
// so it is the time spent connecting that tells, which is 0 on a connection that is used again. MODES (`keep-alive,reconnect`) picks the modes that run: the comparison with the base runs `keep-alive` alone
// on both sides, which on the base is the connection closed after every upload, and judges the speed of it.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const healthHostname = __ENV.HEALTH_HOSTNAME_HEADER || 'health.localhost';
const mib = Number(__ENV.MIB || 16);
const requireHandoff = __ENV.REQUIRE_HANDOFF === '1';
const minMbPerSecond = Number(__ENV.MIN_MB_PER_S || 50);
const vus = Number(__ENV.VUS || 8);
const duration = __ENV.DURATION || '10s';
const modes = (__ENV.MODES || 'keep-alive,reconnect').split(',');
// the second mode starts when the first one is done, with a pause for the last uploads to finish
const secondStart = `${(Number.parseInt(duration, 10) || 10) + 15}s`;
const speed = new Trend('big_upload_mb_per_s');
const newConnection = new Rate('big_upload_new_connection');
const handedOver = new Rate('big_upload_handed_over');
const handedBack = new Rate('big_upload_handed_back');

export const options = {
  scenarios: {
    ...(modes.includes('keep-alive') && { keepAlive: { executor: 'constant-vus', vus, duration, exec: 'keepAlive', tags: { mode: 'keep-alive' } } }),
    ...(modes.includes('reconnect') && {
      reconnect: {
        executor: 'constant-vus',
        vus,
        duration,
        exec: 'reconnect',
        startTime: modes.includes('keep-alive') ? secondStart : '0s',
        tags: { mode: 'reconnect' },
      },
    }),
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    // the sub metrics of a threshold are in the summary export, which the summary of the workflow takes the comparison from
    ...Object.fromEntries(modes.map((mode) => [`http_reqs{mode:${mode}}`, ['count>0']])),
    ...Object.fromEntries(modes.map((mode) => [`big_upload_mb_per_s{mode:${mode}}`, [`p(10)>${minMbPerSecond}`]])),
    ...Object.fromEntries(modes.map((mode) => [`big_upload_new_connection{mode:${mode}}`, ['rate>=0']])),
    // most of the requests after the first of a user, not all: the time to connect to localhost is too short to show in every request on Windows
    ...(requireHandoff
      ? {
          'big_upload_new_connection{mode:keep-alive}': ['rate<0.1'],
          'big_upload_new_connection{mode:reconnect}': ['rate>0.5'],
          big_upload_handed_over: ['rate==1'],
          big_upload_handed_back: ['rate==1'],
        }
      : {}),
  },
};

// a block that repeats, as making every byte of 16 MiB one by one takes seconds in every VU
const block = new Uint8Array(1024 * 1024).map((_, index) => (index * 31) % 251);
const body = new Uint8Array(mib * block.byteLength);
for (let index = 0; index < mib; index += 1) body.set(block, index * block.byteLength);
const sha256 = crypto.sha256(body.buffer, 'hex');

/** the connections that went to the workers with their request, and those that came back, counted by the server since it started */
const readHandOffs = () =>
  http.get(`${baseUrl}/metrics`, { headers: { Host: healthHostname }, tags: { route: 'metrics' } }).json('handOffs.requests') as {
    total: number;
    handedBack: number;
  };

// starts the worker, so that the run does not measure its start
export function setup() {
  http.post(`${baseUrl}/upload/`, block.buffer, { headers: { Host: hostname }, timeout: '30s' });

  return requireHandoff ? readHandOffs() : { total: 0, handedBack: 0 };
}

function upload(headers: Record<string, string>) {
  const response = http.post(`${baseUrl}/upload/`, body.buffer, {
    headers: { Host: hostname, 'Content-Type': 'application/octet-stream', ...headers },
    tags: { route: 'big-upload' },
    timeout: '60s',
  });

  const arrived = check(
    response,
    {
      'big upload status is 200': (r) => r.status === 200,
      'big upload arrived whole': (r) => r.json('size') === body.byteLength,
      'big upload arrived unchanged': (r) => r.json('sha256') === sha256,
    },
    { route: 'big-upload' }
  );

  if (__ITER > 0) newConnection.add(response.timings.connecting > 0);

  // seconds of the whole request, and only for uploads that arrived whole, as a failed one would look fast
  // a duration of 0 (the coarse clock of windows) would make the speed infinite, which the summary file cannot carry
  if (arrived && response.timings.duration > 0) speed.add(body.byteLength / 1e6 / (response.timings.duration / 1000));
}

export function keepAlive() {
  upload({});
}

export function reconnect() {
  upload({ Connection: 'close' });
}

export function teardown(before: { total: number; handedBack: number }) {
  if (!requireHandoff) return;

  const after = readHandOffs();
  handedOver.add(after.total > before.total);
  handedBack.add(after.handedBack > before.handedBack);
}
