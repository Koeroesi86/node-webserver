import http, { type RefinedResponse, type ResponseType } from 'k6/http';
import ws from 'k6/ws';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const lambdaHostname = 'lambda.localhost';
const compressedHostname = 'compressed.localhost';
const uploadHostname = 'upload.localhost';
const healthHostname = 'health.localhost';
// the https and secure websocket routes are only tested when the server runs with a certificate, see README.md
const httpsPort = __ENV.HTTPS_PORT;
const secureHostname = 'secure.localhost';
const wsUrl = baseUrl.replace(/^http/, 'ws');
// the example worker pushes a frame every second, so this many whole seconds of listening is expected to yield this many frames
const wsHoldSeconds = Number(__ENV.WS_HOLD_SECONDS || 3.5);
const wsMinMessages = Math.floor(wsHoldSeconds) - 1;
const wsSessionOk = new Rate('ws_session_ok');
// the thresholds are about twice the worst values seen on the 4 core GitHub runners with 20 HTTP and 10 websocket VUs, over several runs of the same code (the numbers below are from before the server and k6 got cores of their own, see README.md):
// 2190-3900 req/s overall (runners differ by up to 1.8 times), p95 of 6-10 ms for the worker, secure, static and compressed routes, 12-18 ms for the 404, 10-16 ms streamed,
// 20-23 ms for the lambda, 100-200 ms to connect a websocket
const minRequestRate = Number(__ENV.MIN_REQUEST_RATE || 1000);
// the p95 allowed for some routes (and for ws_connecting) instead of their own, for systems where starting processes takes long: `lambda=1500,upload=200` (milliseconds)
// P95_FACTOR scales the p95 allowed for every route, and for ws_connecting, for systems where everything is slower
const p95Factor = Number(__ENV.P95_FACTOR || 1);
const p95Overrides: Record<string, number> = Object.fromEntries(
  (__ENV.P95_OVERRIDES || '')
    .split(',')
    .filter(Boolean)
    .map((entry) => entry.split('='))
    .map(([route, milliseconds]) => [route, Number(milliseconds)])
);
const postBody = JSON.stringify({ hello: 'world' });
// four parts of 64 KiB on their way to the worker, all byte values included
const uploadBody = new Uint8Array(256 * 1024).map((_, index) => (index * 31) % 251).buffer;
const uploadSha256 = crypto.sha256(uploadBody, 'hex');
const streamChunks = 8;
const streamChunkSize = 4096;

type Response = RefinedResponse<ResponseType | undefined>;

interface Route {
  method: string;
  /** a function makes the url anew for every request */
  url: string | (() => string);
  host?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  /** the body of the response is read as bytes */
  binary?: boolean;
  status: number;
  /** only every n-th iteration requests the route */
  every?: number;
  validate: (response: Response) => boolean;
  maxP95: number;
}

const bodyIncludes = (response: Response, text: string) => typeof response.body === 'string' && response.body.includes(text);

// every iteration walks through all routes, so each of them gets the same share of the load, unless `every` says otherwise
const routes: Record<string, Route> = {
  worker: { method: 'GET', url: `${baseUrl}/`, status: 200, validate: (r) => bodyIncludes(r, 'It works!'), maxP95: 20 },
  workerPost: {
    method: 'POST',
    url: `${baseUrl}/`,
    body: postBody,
    status: 200,
    validate: (r) => bodyIncludes(r, 'It works!') && r.headers['X-Request-Body-Length'] === String(postBody.length),
    maxP95: 20,
  },
  static: { method: 'GET', url: `${baseUrl}/static/index.html`, status: 200, validate: (r) => bodyIncludes(r, 'It works!'), maxP95: 20 },
  staticBinary: {
    method: 'GET',
    url: `${baseUrl}/static/favicon.ico`,
    status: 200,
    validate: (r) => r.headers['Content-Type'].startsWith('image/') && Number(r.headers['Content-Length']) > 0,
    maxP95: 20,
  },
  // the example lambda serves the files of the static folder, in a lambda process. A lambda answers one request at a time and there are as many as cores,
  // so only a share of the iterations goes there: the route is meant to measure the lambda, not the queue in front of them
  lambda: {
    method: 'GET',
    url: `${baseUrl}/index.html`,
    host: lambdaHostname,
    status: 200,
    every: 4,
    validate: (r) => bodyIncludes(r, 'It works!'),
    maxP95: 50,
  },
  // a server with compression on: k6 only asks for it when told to, then it decompresses the body and leaves the headers
  compressed: {
    method: 'GET',
    url: `${baseUrl}/`,
    host: compressedHostname,
    headers: { 'Accept-Encoding': 'gzip, br' },
    status: 200,
    every: 2,
    validate: (r) => ['gzip', 'br', 'deflate'].includes(r.headers['Content-Encoding']) && r.headers.Vary === 'Accept-Encoding' && bodyIncludes(r, 'It works!'),
    maxP95: 30,
  },
  // generated while it is sent, in 8 parts of 4 KiB, so it takes a share of the traffic only
  stream: {
    method: 'GET',
    url: `${baseUrl}/stream/?chunks=${streamChunks}&size=${streamChunkSize}`,
    status: 200,
    every: 4,
    binary: true,
    validate: (r) => {
      if (!(r.body instanceof ArrayBuffer)) return false;
      const bytes = new Uint8Array(r.body);

      return (
        bytes.length === streamChunks * streamChunkSize &&
        Array.from({ length: streamChunks }, (_, index) => index).every(
          (index) => bytes[index * streamChunkSize] === index && bytes[(index + 1) * streamChunkSize - 1] === index
        )
      );
    },
    maxP95: 35,
  },
  // the body is passed on to the worker as a stream while it arrives, the worker answers with the size and the hash of what it received
  upload: {
    method: 'POST',
    url: `${baseUrl}/`,
    host: uploadHostname,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: uploadBody,
    status: 200,
    every: 4,
    validate: (r) => r.json('size') === uploadBody.byteLength && r.json('sha256') === uploadSha256,
    maxP95: 60,
  },
  // the worker asks the server for its metrics: process, requests and the pools of workers, which only a share of the iterations needs
  metrics: {
    method: 'GET',
    url: `${baseUrl}/metrics`,
    host: healthHostname,
    status: 200,
    every: 8,
    validate: (r) =>
      Number(r.json('memory.rss')) > 0 &&
      Number(r.json('requests.total')) > 0 &&
      Number(r.json('uptimeSeconds')) > 0 &&
      r.json('sources.lambdas') !== undefined,
    maxP95: 50,
  },
  // every request to a missing file is logged as an error, so it is only a small share of the traffic
  notFound: { method: 'GET', url: `${baseUrl}/static/missing.html`, status: 404, every: 5, validate: (r) => bodyIncludes(r, 'does not exist'), maxP95: 40 },
  // a path that was never asked for before, as a scan of a site is, so nothing that was remembered about an earlier one helps
  notFoundUnique: {
    method: 'GET',
    url: () => `${baseUrl}/static/missing-${__VU}-${__ITER}.html`,
    status: 404,
    every: 5,
    validate: (r) => bodyIncludes(r, 'does not exist'),
    maxP95: 40,
  },
  ...(httpsPort && {
    secure: { method: 'GET', url: `https://${secureHostname}:${httpsPort}/`, status: 200, validate: (r) => bodyIncludes(r, 'It works!'), maxP95: 20 },
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
    ws_connecting: [`p(95)<${p95Overrides.ws_connecting ?? 400 * p95Factor}`],
    ...Object.fromEntries(
      Object.entries(routes).map(([route, { maxP95 }]) => [`http_req_duration{route:${route}}`, [`p(95)<${p95Overrides[route] ?? maxP95 * p95Factor}`]])
    ),
    // also makes k6 report the checks per route, which tells a comparison with another build whether that build can serve the route at all
    ...Object.fromEntries(Object.keys(routes).map((route) => [`checks{route:${route}}`, ['rate>0.999']])),
    // and the requests per route, which tells the comparison how much of the throughput is work for a route that the base cannot serve (the threshold always holds)
    ...Object.fromEntries(Object.keys(routes).map((route) => [`http_reqs{route:${route}}`, ['count>=0']])),
  },
};

export default function () {
  Object.entries(routes)
    .filter(([, { every = 1 }]) => __ITER % every === 0)
    .forEach(([route, { method, url: routeUrl, host, headers, body, binary, status, validate }]) => {
      const url = typeof routeUrl === 'function' ? routeUrl() : routeUrl;
      const response = http.request(method, url, body, {
        headers: { Host: host || (url.startsWith('https') ? secureHostname : hostname), ...(body && { 'Content-Type': 'application/json' }), ...headers },
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
