import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// What goes wrong with lambdas, against the three lambda servers of the load test configuration (see configuration.load-test.ts):
//  - crash: a lambda that ends its process answers its own request with 502 and nobody else's, while other requests are answered (200) all the time,
//  - overload: more requests than the 2 lambdas can run, each of which takes 1.5 seconds. The ones that find no lambda within half a second (acquireTimeout) are answered with 503,
//    close to the half second and not later, the others with 200, and none hangs,
//  - file: the `file` communication answers like the default one.
// Run on its own, as the lambdas are processes that take the cores of the other routes. The comparison with the base does not run it: a base without the servers answers them with errors.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const acquireTimeout = 500;
// the 503 is answered when the timer of the server fires: this much later it would mean that the request waited for something else. Shared runners, and Windows with its processes, are slow.
const margin = Number(__ENV.MARGIN_MS || 1000);
const duration = __ENV.DURATION || '10s';

const overloaded = new Counter('lambda_overloaded');
const served = new Counter('lambda_served_under_overload');

export const options = {
  scenarios: {
    crash: { executor: 'constant-vus', vus: 1, duration, exec: 'crash' },
    healthy: { executor: 'constant-vus', vus: 2, duration, exec: 'healthy' },
    overload: { executor: 'constant-vus', vus: 8, duration, exec: 'overload' },
    file: { executor: 'constant-vus', vus: 2, duration, exec: 'file' },
  },
  thresholds: {
    checks: ['rate>0.999'],
    'checks{route:lambda-crash}': ['rate>0.999'],
    'checks{route:lambda-healthy}': ['rate>0.999'],
    'checks{route:lambda-overload}': ['rate>0.999'],
    'checks{route:lambda-file}': ['rate>0.999'],
    // the scenario only tests the overload when there was one, and when the lambdas still did their work
    lambda_overloaded: ['count>0'],
    lambda_served_under_overload: ['count>0'],
  },
};

const get = (host: string, path: string, route: string) => http.get(`${baseUrl}${path}`, { headers: { Host: host }, tags: { route }, timeout: '10s' });

export function crash() {
  const response = get('lambda-crash.localhost', '/crash', 'lambda-crash');

  check(
    response,
    {
      'crashed lambda is answered with 502': (r) => r.status === 502,
      'crashed lambda does not tell why': (r) => r.json('message') === 'Internal server error' && !String(r.body).includes('exit'),
    },
    { route: 'lambda-crash' }
  );
}

// the requests that run next to the crashes
export function healthy() {
  const response = get('lambda-crash.localhost', '/ok', 'lambda-healthy');

  check(response, { 'request next to a crash is answered with 200': (r) => r.status === 200 && r.json('ok') === true }, { route: 'lambda-healthy' });
}

export function overload() {
  const response = get('lambda-overload.localhost', '/slow?ms=1500', 'lambda-overload');

  if (response.status === 503) overloaded.add(1);
  if (response.status === 200) served.add(1);

  check(
    response,
    {
      'overloaded request is answered with 200 or 503': (r) => r.status === 200 || r.status === 503,
      '503 comes when the acquire timeout passed, and not much later': (r) =>
        r.status !== 503 || (r.timings.duration >= acquireTimeout - 50 && r.timings.duration < acquireTimeout + margin),
    },
    { route: 'lambda-overload' }
  );
}

export function file() {
  const response = get('lambda-file.localhost', '/ok', 'lambda-file');

  check(response, { 'file communication is answered with 200': (r) => r.status === 200 && r.json('ok') === true }, { route: 'lambda-file' });
}
