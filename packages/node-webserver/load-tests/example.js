import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';

export const options = {
  scenarios: {
    constantLoad: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    // a stalled server only produces a few timeouts per second next to thousands of healthy requests, so this has to be strict
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
    // sanity floor for overall throughput
    http_reqs: [`rate>${__ENV.MIN_REQUEST_RATE || 100}`],
  },
};

export default function () {
  const response = http.get(baseUrl, { headers: { Host: hostname }, timeout: '5s' });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'body contains example page': (r) => typeof r.body === 'string' && r.body.includes('It works!'),
  });
}
