import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const lambdaHostname = 'lambda.localhost';
// the https and secure websocket routes are only tested when the server runs with a certificate, see README.md
const httpsPort = __ENV.HTTPS_PORT;
const secureHostname = 'secure.localhost';
const wsUrl = baseUrl.replace(/^http/, 'ws');
// the example worker pushes a frame every second, so this many whole seconds of listening is expected to yield this many frames
const wsHoldSeconds = Number(__ENV.WS_HOLD_SECONDS || 3.5);
const wsMinMessages = Math.floor(wsHoldSeconds) - 1;
const wsSessionOk = new Rate('ws_session_ok');
// the thresholds are about twice the worst values seen on the 4 core GitHub runners with 20 HTTP and 10 websocket VUs:
// 1520-1930 req/s overall, p95 of 12-15 ms for the worker, secure and static routes, 23-29 ms for the 404, 30-34 ms for the lambda, 132-180 ms to connect a websocket
const minRequestRate = Number(__ENV.MIN_REQUEST_RATE || 760);
const postBody = JSON.stringify({ hello: 'world' });
const streamChunks = 8;
const streamChunkSize = 4096;

// every iteration walks through all routes, so each of them gets the same share of the load, unless `every` says otherwise
const routes = {
  worker: { method: 'GET', url: `${baseUrl}/`, status: 200, validate: (r) => r.body.includes('It works!'), maxP95: 30 },
  workerPost: {
    method: 'POST',
    url: `${baseUrl}/`,
    body: postBody,
    status: 200,
    validate: (r) => r.body.includes('It works!') && r.headers['X-Request-Body-Length'] === String(postBody.length),
    maxP95: 30,
  },
  static: { method: 'GET', url: `${baseUrl}/static/index.html`, status: 200, validate: (r) => r.body.includes('It works!'), maxP95: 30 },
  staticBinary: {
    method: 'GET',
    url: `${baseUrl}/static/favicon.ico`,
    status: 200,
    validate: (r) => r.headers['Content-Type'].startsWith('image/') && Number(r.headers['Content-Length']) > 0,
    maxP95: 30,
  },
  // the example lambda serves the files of the static folder, in a lambda process. A lambda answers one request at a time and there are as many as cores,
  // so only a share of the iterations goes there: the route is meant to measure the lambda, not the queue in front of them
  lambda: { method: 'GET', url: `${baseUrl}/index.html`, host: lambdaHostname, status: 200, every: 4, validate: (r) => r.body.includes('It works!'), maxP95: 50 },
  // generated while it is sent, in 8 parts of 4 KiB, so it takes a share of the traffic only
  stream: {
    method: 'GET',
    url: `${baseUrl}/stream/?chunks=${streamChunks}&size=${streamChunkSize}`,
    status: 200,
    every: 4,
    binary: true,
    validate: (r) => {
      const bytes = new Uint8Array(r.body);

      return bytes.length === streamChunks * streamChunkSize && Array.from({ length: streamChunks }, (_, index) => index).every((index) => bytes[index * streamChunkSize] === index && bytes[(index + 1) * streamChunkSize - 1] === index);
    },
    maxP95: 35,
  },
  // every request to a missing file is logged as an error, so it is only a small share of the traffic
  notFound: { method: 'GET', url: `${baseUrl}/static/missing.html`, status: 404, every: 5, validate: (r) => r.body.includes('does not exist'), maxP95: 60 },
  ...(httpsPort && {
    secure: { method: 'GET', url: `https://${secureHostname}:${httpsPort}/`, status: 200, validate: (r) => r.body.includes('It works!'), maxP95: 30 },
  }),
};

export const options = {
  insecureSkipTLSVerify: true,
  hosts: { [secureHostname]: '127.0.0.1' },
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
    ws_connecting: ['p(95)<360'],
    ...Object.fromEntries(Object.entries(routes).map(([route, { maxP95 }]) => [`http_req_duration{route:${route}}`, [`p(95)<${maxP95}`]])),
  },
};

export default function () {
  Object.entries(routes)
    .filter(([, { every = 1 }]) => __ITER % every === 0)
    .forEach(([route, { method, url, host, body, binary, status, validate }]) => {
      const response = http.request(method, url, body, {
        headers: { Host: host || (url.startsWith('https') ? secureHostname : hostname), ...(body && { 'Content-Type': 'application/json' }) },
        tags: { route },
        timeout: '5s',
        responseCallback: http.expectedStatuses(status),
        ...(binary && { responseType: 'binary' }),
      });

      check(
        response,
        {
          [`${route} status is ${status}`]: (r) => r.status === status,
          [`${route} response is as expected`]: (r) => r.status === status && validate(r),
        },
        { route }
      );
    });
}

export function websocketSession() {
  const secure = Boolean(httpsPort) && __ITER % 2 === 1;
  const route = secure ? 'websocketSecure' : 'websocket';
  const url = secure ? `wss://${secureHostname}:${httpsPort}/websocket/exampleWorker.js` : `${wsUrl}/websocket/exampleWorker.js`;
  let received = 0;
  let valid = true;
  let closedCleanly = false;

  const response = ws.connect(url, { headers: { Host: secure ? secureHostname : hostname }, tags: { route } }, (socket) => {
    socket.on('message', (data) => {
      received += 1;
      valid = valid && typeof JSON.parse(data).now === 'number';
    });
    socket.on('close', () => {
      closedCleanly = true;
    });
    socket.setTimeout(() => socket.close(), wsHoldSeconds * 1000);
  });

  const upgraded = check(response, { [`${route} upgraded`]: (r) => r && r.status === 101 }, { route });
  check(null, { [`${route} frames received`]: () => received >= wsMinMessages, [`${route} frames are valid`]: () => valid }, { route });
  wsSessionOk.add(upgraded && received >= wsMinMessages && valid && closedCleanly);
}
