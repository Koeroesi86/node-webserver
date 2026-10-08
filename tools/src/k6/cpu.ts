import http from 'k6/http';
import { check } from 'k6';

// Requests for a worker that keeps its process busy, at a rate that no single worker can follow: each request takes about 9 ms
// of a core, so one worker handles at most ~110 per second. Spread over the workers of the machine the rate is easy, and
// the latency stays low. Run on its own, as other traffic would take the cores the workers need.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const rounds = 8000;
// 11-24 ms were seen on the 4 core GitHub runners, where a single worker needs seconds
const maxP95 = Number(__ENV.MAX_P95_MS || 50);
// systems where k6 shares starved cores with the workers drop a few iterations without the server being at fault
const maxDropped = Number(__ENV.MAX_DROPPED || 0);

export const options = {
  scenarios: {
    // a fixed arrival rate instead of virtual users that wait for each other, so a slow server shows as latency and dropped requests
    cpu: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CPU_RATE || 150),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    // requests the server could not take on time would be dropped
    dropped_iterations: [`count<${maxDropped + 1}`],
    'http_req_duration{route:cpu}': [`p(95)<${maxP95}`],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/cpu/?rounds=${rounds}`, { headers: { Host: hostname }, tags: { route: 'cpu' }, timeout: '10s' });

  check(
    response,
    {
      'cpu status is 200': (r) => r.status === 200,
      'cpu response is as expected': (r) => r.status === 200 && r.json('rounds') === rounds && String(r.json('digest')).length === 64,
    },
    { route: 'cpu' }
  );
}
