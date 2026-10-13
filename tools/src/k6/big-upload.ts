import crypto from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Parallel uploads of a big body with a Content-Length to web.localhost/upload/ (examples/upload/exampleWorker.js: the size and sha256 of what it received), which the server hands to the worker
// to read from the client itself (node-worker-express, `handOffRequests`), so that the bytes do not pass through the one front process. Every upload is checked by the size and the sha256 the worker
// answers with, and its speed in MB/s is a metric of its own: a front process that carries the bytes shows as uploads that get slower the more of them run at once, with a floor on the slowest tenth as the threshold.
// REQUIRE_HANDOFF=1 also checks that the connections did not outlive the uploads, which only a handed over request causes (the worker closes the connection after its response): the next request of a user has to
// open a new connection. k6 does not show the header in `headers`, so it is the time spent connecting that tells, which is 0 on a connection that is used again, and the share of requests that opened one
// (`big_upload_new_connection`) has to be above half. Run on its own and not part of the comparison with the base.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const mib = Number(__ENV.MIB || 16);
const requireHandoff = __ENV.REQUIRE_HANDOFF === '1';
const minMbPerSecond = Number(__ENV.MIN_MB_PER_S || 50);
const speed = new Trend('big_upload_mb_per_s');
const newConnection = new Rate('big_upload_new_connection');

export const options = {
  scenarios: {
    upload: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 8),
      duration: __ENV.DURATION || '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    big_upload_mb_per_s: [`p(10)>${minMbPerSecond}`],
    // most of the requests after the first of a user, not all: the time to connect to localhost is too short to show in every request on Windows
    ...(requireHandoff ? { big_upload_new_connection: ['rate>0.5'] } : {}),
  },
};

// a block that repeats, as making every byte of 16 MiB one by one takes seconds in every VU
const block = new Uint8Array(1024 * 1024).map((_, index) => (index * 31) % 251);
const body = new Uint8Array(mib * block.byteLength);
for (let index = 0; index < mib; index += 1) body.set(block, index * block.byteLength);
const sha256 = crypto.sha256(body.buffer, 'hex');

// starts the worker, so that the run does not measure its start
export function setup() {
  http.post(`${baseUrl}/upload/`, block.buffer, { headers: { Host: hostname }, timeout: '30s' });
}

export default function () {
  const response = http.post(`${baseUrl}/upload/`, body.buffer, {
    headers: { Host: hostname, 'Content-Type': 'application/octet-stream' },
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

  if (requireHandoff && __ITER > 0) newConnection.add(response.timings.connecting > 0);

  // seconds of the whole request, and only for uploads that arrived whole, as a failed one would look fast
  if (arrived) speed.add(body.byteLength / 1e6 / (response.timings.duration / 1000));
}
