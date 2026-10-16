export const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
export const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
export const lambdaHostname = 'lambda.localhost';
export const compressedHostname = 'compressed.localhost';
export const uploadHostname = 'upload.localhost';
export const healthHostname = 'health.localhost';
export const proxiedHostname = 'proxied.localhost';
// the https and secure websocket routes are only tested when the server runs with a certificate, see README.md
export const httpsPort = __ENV.HTTPS_PORT;
export const secureHostname = 'secure.localhost';
export const wsUrl = baseUrl.replace(/^http/, 'ws');
// the example worker pushes a frame every second, so this many whole seconds of listening is expected to yield this many frames
export const wsHoldSeconds = Number(__ENV.WS_HOLD_SECONDS || 3.5);
export const wsMinMessages = Math.floor(wsHoldSeconds) - 1;
// the thresholds are about twice the worst values seen on the 4 core GitHub runners with 20 HTTP and 10 websocket VUs, over several runs of the same code (the numbers below are from before the server and k6 got cores of their own, see README.md):
// 2190-3900 req/s overall (runners differ by up to 1.8 times), p95 of 6-10 ms for the worker, secure, static and compressed routes, 12-18 ms for the 404, 10-16 ms streamed,
// 20-23 ms for the lambda, 100-200 ms to connect a websocket
export const minRequestRate = Number(__ENV.MIN_REQUEST_RATE || 1000);
// the p95 allowed for some routes (and for ws_connecting) instead of their own, for systems where starting processes takes long: `lambda=1500,upload=200` (milliseconds)
// P95_FACTOR scales the p95 allowed for every route, and for ws_connecting, for systems where everything is slower
export const p95Factor = Number(__ENV.P95_FACTOR || 1);
export const p95Overrides: Record<string, number> = Object.fromEntries(
  (__ENV.P95_OVERRIDES || '')
    .split(',')
    .filter(Boolean)
    .map((entry) => entry.split('='))
    .map(([route, milliseconds]) => [route, Number(milliseconds)])
);
