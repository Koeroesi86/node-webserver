import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const wsUrl = baseUrl.replace(/^http/, 'ws');
// the example worker pushes a frame every second, so this many whole seconds of listening is expected to yield this many frames
const wsHoldSeconds = Number(__ENV.WS_HOLD_SECONDS || 3.5);
const wsMinMessages = Math.floor(wsHoldSeconds) - 1;
const wsSessionOk = new Rate('ws_session_ok');
// the thresholds are about twice the worst values seen on the 4 core GitHub runners with 20 HTTP and 10 websocket VUs
// (1050-1580 req/s overall, 135-150 ms websocket connect p95), as run to run noise is around 25%
const minRequestRate = Number(__ENV.MIN_REQUEST_RATE || 700);

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
    websocket: {
      executor: 'constant-vus',
      exec: 'websocketSession',
      vus: Number(__ENV.WS_VUS || 10),
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    // a stalled server only produces a few timeouts per second next to thousands of healthy requests, so this has to be strict
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    http_reqs: [`rate>${minRequestRate}`],
    // a session is ok when the upgrade succeeded, frames kept arriving and the connection closed cleanly
    ws_session_ok: ['rate>0.99'],
    ws_connecting: ['p(95)<500'],
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

export function websocketSession() {
  let received = 0;
  let valid = true;
  let closedCleanly = false;

  const response = ws.connect(`${wsUrl}/websocket/exampleWorker.js`, { headers: { Host: hostname }, tags: { route: 'websocket' } }, (socket) => {
    socket.on('message', (data) => {
      received += 1;
      valid = valid && typeof JSON.parse(data).now === 'number';
    });
    socket.on('close', () => {
      closedCleanly = true;
    });
    socket.setTimeout(() => socket.close(), wsHoldSeconds * 1000);
  });

  const ok = check(response, { 'websocket upgraded': (r) => r && r.status === 101 }, { route: 'websocket' }) && received >= wsMinMessages && valid && closedCleanly;
  check(null, { 'websocket frames received': () => received >= wsMinMessages, 'websocket frames are valid': () => valid }, { route: 'websocket' });
  wsSessionOk.add(ok);
}
