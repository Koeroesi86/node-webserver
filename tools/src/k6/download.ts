import http, { type RefinedResponse } from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Parallel downloads of a big body with a Content-Length from examples/download/exampleWorker.js, which the server hands to the worker to write to the client itself (node-worker-express, `handOffResponses`),
// so that the bytes do not pass through the one front process. Every download is checked whole (its size, and one byte of the first, the middle and the last part), and its speed in MB/s is a metric of its own:
// a front process that carries the bytes shows as downloads that get slower the more of them run at once, with a floor on the slowest tenth as the threshold.
// The downloads run twice on the same server, one mode after the other: `keep-alive` leaves the connection to the server, which the worker gives back after the body so that the client sends its next request on it,
// and `reconnect` sends `Connection: close`, which makes the worker close it as every handed over download did before, so the next download opens a new connection. The metrics of both have the tag `mode`,
// and the summary of the workflow puts them side by side: that is the measure of what a reconnect costs next to a body of this size.
// REQUIRE_HANDOFF=1 also checks that the handoff and the hand back happened, which the client cannot tell by the connection alone: the counters of the metrics of the server (`handOffs.responses` at
// health.localhost/metrics) must have grown by the end of the run, the downloads of `keep-alive` must have reused their connections, and those of `reconnect` must not have. k6 does not show the header of a handed over
// response in `headers`, so it is the time spent connecting that tells, which is 0 on a connection that is used again. MODES (`keep-alive,reconnect`) picks the modes that run: the comparison with the base runs
// `keep-alive` alone on both sides, which on the base is the connection closed after every download, and judges the speed of it.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const healthHostname = __ENV.HEALTH_HOSTNAME_HEADER || 'health.localhost';
const mib = Number(__ENV.MIB || 32);
const size = mib * 1024 * 1024;
const requireHandoff = __ENV.REQUIRE_HANDOFF === '1';
const minMbPerSecond = Number(__ENV.MIN_MB_PER_S || 50);
const vus = Number(__ENV.VUS || 8);
const duration = __ENV.DURATION || '10s';
const modes = (__ENV.MODES || 'keep-alive,reconnect').split(',');
// the second mode starts when the first one is done, with a pause for the last downloads to finish
const secondStart = `${(Number.parseInt(duration, 10) || 10) + 15}s`;
const speed = new Trend('download_mb_per_s');
const newConnection = new Rate('download_new_connection');
const handedOver = new Rate('download_handed_over');
const handedBack = new Rate('download_handed_back');

export const options = {
  scenarios: {
    ...(modes.includes('keep-alive') && { keepAlive: { executor: 'constant-vus', vus, duration, exec: 'keepAlive', tags: { mode: 'keep-alive' } } }),
    ...(modes.includes('reconnect') && {
      reconnect: {
        executor: 'constant-vus',
        vus,
        duration,
        exec: 'reconnect',
        startTime: modes.includes('keep-alive') ? secondStart : '0s',
        tags: { mode: 'reconnect' },
      },
    }),
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    // the sub metrics of a threshold are in the summary export, which the summary of the workflow takes the comparison from
    ...Object.fromEntries(modes.map((mode) => [`http_reqs{mode:${mode}}`, ['count>0']])),
    ...Object.fromEntries(modes.map((mode) => [`download_mb_per_s{mode:${mode}}`, [`p(10)>${minMbPerSecond}`]])),
    ...Object.fromEntries(modes.map((mode) => [`download_new_connection{mode:${mode}}`, ['rate>=0']])),
    // most of the requests after the first of a user, not all: the time to connect to localhost is too short to show in every request on Windows (23% of them read 0 there with the handoff working)
    ...(requireHandoff
      ? {
          'download_new_connection{mode:keep-alive}': ['rate<0.1'],
          'download_new_connection{mode:reconnect}': ['rate>0.5'],
          download_handed_over: ['rate==1'],
          download_handed_back: ['rate==1'],
        }
      : {}),
  },
};

/** the connections that went to the workers to write a response, and those that came back, counted by the server since it started */
const readHandOffs = () =>
  http.get(`${baseUrl}/metrics`, { headers: { Host: healthHostname }, tags: { route: 'metrics' } }).json('handOffs.responses') as {
    total: number;
    handedBack: number;
  };

// starts the worker, so that the run does not measure its start
export function setup() {
  http.get(`${baseUrl}/download/?mib=1`, { headers: { Host: hostname }, timeout: '30s' });

  return requireHandoff ? readHandOffs() : { total: 0, handedBack: 0 };
}

const hasClose = (headers: Record<string, string>) =>
  Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'connection' && value.toLowerCase() === 'close');

// the first request of a user opens a connection in any case, the ones after it only when the one before was closed by the response
const opensConnection = (response: RefinedResponse<'binary'>) => response.timings.connecting > 0 || hasClose(response.headers);

function download(headers: Record<string, string>) {
  const response = http.get(`${baseUrl}/download/?mib=${mib}`, {
    headers: { Host: hostname, ...headers },
    tags: { route: 'download' },
    timeout: '60s',
    responseType: 'binary',
  });
  const body = response.body instanceof ArrayBuffer ? new Uint8Array(response.body) : undefined;
  const part = 1024 * 1024;
  const middle = Math.floor(mib / 2);

  check(
    response,
    {
      'download status is 200': (r) => r.status === 200,
      'download is whole': () => body?.byteLength === size,
      'download has the bytes of its parts': () => body?.[0] === 0 && body[middle * part] === middle % 256 && body[size - 1] === (mib - 1) % 256,
    },
    { route: 'download' }
  );

  if (__ITER > 0) newConnection.add(opensConnection(response));

  // seconds of the whole request, and only for downloads that arrived whole, as a failed one would look fast
  if (body?.byteLength === size) speed.add(size / 1e6 / (response.timings.duration / 1000));
}

export function keepAlive() {
  download({});
}

export function reconnect() {
  download({ Connection: 'close' });
}

export function teardown(before: { total: number; handedBack: number }) {
  if (!requireHandoff) return;

  const after = readHandOffs();
  handedOver.add(after.total > before.total);
  handedBack.add(after.handedBack > before.handedBack);
}
