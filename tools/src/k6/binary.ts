import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

// Binary responses of 768 KiB from a worker, each in a single message, all byte values included: the size of the files that the example load test does not measure.
// Run on its own, as the big bodies would take the cores of the other routes. The comparison with the base runs it after the CPU bound run and does not judge a base that cannot serve the route,
// as it would answer with fast errors and look better for it.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const size = 768 * 1024;
const sha256 = crypto.sha256(new Uint8Array(size).map((_, index) => (index * 31) % 251).buffer, 'hex');
const maxP95 = Number(__ENV.MAX_P95_MS || 100);

export const options = {
  scenarios: {
    binary: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    // a threshold on the sub metric is what puts it into the summary, which the comparison with the base reads to tell a base that cannot serve the route
    'checks{route:binary}': ['rate>0.999'],
    'http_req_duration{route:binary}': [`p(95)<${maxP95}`],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/binary/?size=${size}`, {
    headers: { Host: hostname },
    tags: { route: 'binary' },
    timeout: '10s',
    responseType: 'binary',
  });

  check(
    response,
    {
      'binary status is 200': (r) => r.status === 200,
      'binary response is as expected': (r) =>
        r.status === 200 && r.body instanceof ArrayBuffer && r.body.byteLength === size && crypto.sha256(r.body, 'hex') === sha256,
    },
    { route: 'binary' }
  );
}
