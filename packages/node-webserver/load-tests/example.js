import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
// the thresholds are about twice the worst values seen on the 4 core GitHub runners with 20 VUs (1190-1580 req/s overall), as run to run noise is around 25%
const minRequestRate = Number(__ENV.MIN_REQUEST_RATE || 800);

// every iteration walks through all routes, so each of them gets the same share of the load
const routes = {
  worker: { method: 'GET', path: '/', status: 200, includes: 'It works!', maxP95: 25 },
  workerPost: { method: 'POST', path: '/', status: 200, includes: 'It works!', body: JSON.stringify({ hello: 'world' }), maxP95: 25 },
  static: { method: 'GET', path: '/static/index.html', status: 200, maxP95: 100 },
  staticBinary: { method: 'GET', path: '/static/favicon.ico', status: 200, maxP95: 100 },
  notFound: { method: 'GET', path: '/static/missing.html', status: 404, maxP95: 60 },
};

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
    checks: ['rate>0.999'],
    http_reqs: [`rate>${minRequestRate}`],
    ...Object.fromEntries(Object.entries(routes).map(([route, { maxP95 }]) => [`http_req_duration{route:${route}}`, [`p(95)<${maxP95}`]])),
  },
};

export default function () {
  Object.entries(routes).forEach(([route, { method, path, status, includes, body }]) => {
    const response = http.request(method, `${baseUrl}${path}`, body, {
      headers: { Host: hostname, ...(body && { 'Content-Type': 'application/json' }) },
      tags: { route },
      timeout: '5s',
      responseCallback: http.expectedStatuses(status),
    });

    check(
      response,
      {
        [`${route} status is ${status}`]: (r) => r.status === status,
        [`${route} body is as expected`]: (r) => includes === undefined || (typeof r.body === 'string' && r.body.includes(includes)),
      },
      { route }
    );
  });
}
