import http from 'k6/http';
import { check } from 'k6';

// The same worker reached two ways, every request with a path not seen before: through the table of routes of routes.localhost, where the route is the last of 401,
// and by looking for it in the files under the root of web.localhost, which asks the file system about the new path. The p95 of the two routes side by side shows
// whether matching the table costs more than the probe it replaces. Run on its own and not part of the comparison with the base, which has no table of routes.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const maxP95 = Number(__ENV.MAX_P95_MS || 50);
const routes = {
  routed: { host: 'routes.localhost', path: (id: number) => `/items/${id}` },
  probed: { host: 'web.localhost', path: (id: number) => `/routes/${id}` },
};

export const options = {
  scenarios: {
    routes: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    'http_req_duration{route:routed}': [`p(95)<${maxP95}`],
    'http_req_duration{route:probed}': [`p(95)<${maxP95}`],
  },
};

const request = (route: keyof typeof routes, id: number, tag: string = route) =>
  http.get(`${baseUrl}${routes[route].path(id)}`, { headers: { Host: routes[route].host }, tags: { route: tag }, timeout: '10s' });

// starts the workers of both, so that the run does not measure their start
export function setup() {
  for (let index = 0; index < 20; index += 1) {
    request('routed', index, 'warm-up');
    request('probed', index, 'warm-up');
  }
}

export default function () {
  // unique for the whole run, so that no path is remembered from before
  const id = __VU * 1000000 + __ITER;

  for (const route of ['routed', 'probed'] as const) {
    const response = request(route, id);
    check(
      response,
      {
        [`${route} status is 200`]: (r) => r.status === 200,
        [`${route} answers for the item`]: (r) => r.body === `item ${id}`,
      },
      { route }
    );
  }
}
