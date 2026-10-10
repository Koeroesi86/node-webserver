import http from 'k6/http';
import { check } from 'k6';

// The same handler of the same file reached two ways, so that the invocation is the same and only the way to it differs: through the table of 402 routes of lambda-routes.localhost,
// where `/items/<id>` is the 401st (200 paths and 200 patterns come before it), and as the single lambda of lambda-single.localhost, which has no table. The p95 of the two routes side by side
// shows whether matching the table costs anything noticeable next to the invocation. `/orders` is another handler of the file on the first server, which has a pool and a limit of its own.
// Run on its own, as the lambdas are processes that take the cores of the other routes, and not part of the comparison with the base, which has no table of routes.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const maxP95 = Number(__ENV.MAX_P95_MS || 50);
const routes = {
  routed: { host: 'lambda-routes.localhost', path: (id: number) => `/items/${id}`, body: (id: number) => `item ${id}` },
  single: { host: 'lambda-single.localhost', path: (id: number) => `/items/${id}`, body: (id: number) => `item ${id}` },
  orders: { host: 'lambda-routes.localhost', path: () => '/orders', body: () => 'orders' },
};

export const options = {
  scenarios: {
    lambdaRoutes: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 4),
      duration: __ENV.DURATION || '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    'http_req_duration{route:lambda-routed}': [`p(95)<${maxP95}`],
    'http_req_duration{route:lambda-single}': [`p(95)<${maxP95}`],
    'http_req_duration{route:lambda-orders}': [`p(95)<${maxP95}`],
  },
};

const request = (route: keyof typeof routes, id: number, tag: string = `lambda-${route}`) =>
  http.get(`${baseUrl}${routes[route].path(id)}`, { headers: { Host: routes[route].host }, tags: { route: tag }, timeout: '10s' });

// starts the lambdas of all three, so that the run does not measure their start
export function setup() {
  for (let index = 0; index < 8; index += 1) {
    (Object.keys(routes) as Array<keyof typeof routes>).forEach((route) => request(route, index, 'warm-up'));
  }
}

export default function () {
  const id = __VU * 1000000 + __ITER;

  for (const route of ['routed', 'single', 'orders'] as const) {
    const response = request(route, id);
    check(
      response,
      {
        [`${route} status is 200`]: (r) => r.status === 200,
        [`${route} answers for the right handler`]: (r) => r.body === routes[route].body(id),
      },
      { route: `lambda-${route}` }
    );
  }
}
