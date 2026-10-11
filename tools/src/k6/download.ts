import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

// Parallel downloads of a big body with a Content-Length from examples/download/exampleWorker.js, which the server hands to the worker to write to the client itself (node-worker-express, `handOffResponses`),
// so that the bytes do not pass through the one front process. Every download is checked whole (its size, and one byte of the first, the middle and the last part), and its speed in MB/s is a metric of its own:
// a front process that carries the bytes shows as downloads that get slower the more of them run at once, with a floor on the slowest tenth as the threshold.
// REQUIRE_HANDOFF=1 also checks that the response says `Connection: close`, which only a handed over one does (the handoff is off on Windows). Run on its own and not part of the comparison with the base.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const mib = Number(__ENV.MIB || 32);
const size = mib * 1024 * 1024;
const requireHandoff = __ENV.REQUIRE_HANDOFF === '1';
const minMbPerSecond = Number(__ENV.MIN_MB_PER_S || 50);
const speed = new Trend('download_mb_per_s');

export const options = {
  scenarios: {
    download: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 8),
      duration: __ENV.DURATION || '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    download_mb_per_s: [`p(10)>${minMbPerSecond}`],
  },
};

// starts the worker, so that the run does not measure its start
export function setup() {
  http.get(`${baseUrl}/download/?mib=1`, { headers: { Host: hostname }, timeout: '30s' });
}

const hasClose = (headers: Record<string, string>) =>
  Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'connection' && value.toLowerCase() === 'close');

export default function () {
  const response = http.get(`${baseUrl}/download/?mib=${mib}`, {
    headers: { Host: hostname },
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
      ...(requireHandoff ? { 'download was handed to the worker': (r) => hasClose(r.headers) } : {}),
    },
    { route: 'download' }
  );

  // seconds of the whole request, and only for downloads that arrived whole, as a failed one would look fast
  if (body?.byteLength === size) speed.add(size / 1e6 / (response.timings.duration / 1000));
}
