import http from 'k6/http';
import { check } from 'k6';

// The server with 2 front processes (FRONT_PROCESSES=2): the worker and lambda routes, and with a certificate the https one, on connections that are kept and on new ones,
// which the primary hands to the fronts in turn. It asks for no failed request. How the throughput scales with the fronts is not measured here, as the runners have too few cores
// to show it, so the p95 only catches a collapse. Run on its own and not part of the comparison with the base, which may run one front only.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const httpsPort = __ENV.HTTPS_PORT;
const maxP95 = Number(__ENV.MAX_P95_MS || 500);
const duration = __ENV.DURATION || '15s';
const secureHostname = 'secure.localhost';

const routes = {
  worker: { url: `${baseUrl}/`, host: 'web.localhost' },
  lambda: { url: `${baseUrl}/`, host: 'lambda.localhost' },
  ...(httpsPort && { secure: { url: `https://${secureHostname}:${httpsPort}/`, host: secureHostname } }),
};

export const options = {
  insecureSkipTLSVerify: true,
  hosts: { [secureHostname]: '127.0.0.1' },
  scenarios: {
    kept: { executor: 'constant-vus', exec: 'kept', vus: Number(__ENV.VUS || 10), duration },
    fresh: { executor: 'constant-vus', exec: 'fresh', vus: Number(__ENV.FRESH_VUS || 4), duration },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    ...Object.fromEntries(Object.keys(routes).map((route) => [`http_req_duration{route:${route}}`, [`p(95)<${maxP95}`]])),
  },
};

const requestAll = (headers: Record<string, string>) =>
  Object.entries(routes).forEach(([route, { url, host }]) => {
    const response = http.get(url, { headers: { Host: host, ...headers }, tags: { route }, timeout: '10s' });
    check(response, { [`${route} status is 200`]: (r) => r.status === 200 }, { route });
  });

export function kept() {
  requestAll({});
}

/** a connection of its own for every request */
export function fresh() {
  requestAll({ Connection: 'close' });
}
