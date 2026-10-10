import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// New TLS connections, which the example load test hardly makes (its users keep their connections): every request on the https port opens a connection of its own,
// so the front server does a full handshake for each, on the thread that proxies every other request. Next to it a fixed rate of plain HTTP requests
// shows what the handshakes cost the other routes, and the server reports how late its event loop ran.
// Needs the certificate of secure.localhost (`HTTPS_PORT`, see README.md). Run on its own and not part of the comparison with the base.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const healthHostname = 'health.localhost';
const secureHostname = 'secure.localhost';
const httpsPort = __ENV.HTTPS_PORT || '8443';
const duration = __ENV.DURATION || '15s';
// the p95 allowed for the requests (plain HTTP and the ones after a handshake) while the handshakes run, and for the handshake itself, in milliseconds
const maxPlainP95 = Number(__ENV.MAX_PLAIN_P95_MS || 50);
const maxHandshakeP95 = Number(__ENV.MAX_HANDSHAKE_P95_MS || 100);
// the longest the event loop of the server was late in each half second
const eventLoopMax = new Trend('tls_server_event_loop_max_ms');

export const options = {
  // a new connection for every iteration, for all scenarios: the plain HTTP ones cost the server a TCP connection, which is small next to a handshake
  noVUConnectionReuse: true,
  insecureSkipTLSVerify: true,
  hosts: { [secureHostname]: '127.0.0.1' },
  scenarios: {
    handshakes: { executor: 'constant-vus', exec: 'handshake', vus: Number(__ENV.VUS || 10), duration },
    plain: {
      executor: 'constant-arrival-rate',
      exec: 'plain',
      rate: Number(__ENV.PLAIN_RATE || 100),
      timeUnit: '1s',
      duration,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
    eventLoop: { executor: 'constant-vus', exec: 'sampleEventLoop', vus: 1, duration },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    'http_req_tls_handshaking{route:handshake}': [`p(95)<${maxHandshakeP95}`],
    'http_req_duration{route:handshake}': [`p(95)<${maxPlainP95}`],
    'http_req_duration{route:plain}': [`p(95)<${maxPlainP95}`],
  },
};

/** a request on a connection of its own: k6 does not resume TLS sessions, so each of them is a full handshake */
export function handshake() {
  const response = http.get(`https://${secureHostname}:${httpsPort}/`, { headers: { Host: secureHostname }, tags: { route: 'handshake' } });
  check(response, { 'handshake answered': (r) => r.status === 200 && r.tls_version !== '' }, { route: 'handshake' });
}

export function plain() {
  const response = http.get(`${baseUrl}/`, { headers: { Host: hostname }, tags: { route: 'plain' } });
  check(response, { 'plain answered': (r) => r.status === 200 }, { route: 'plain' });
}

/** the server measures its event loop between two reads of its metrics */
export function sampleEventLoop() {
  const response = http.get(`${baseUrl}/metrics`, { headers: { Host: healthHostname }, tags: { route: 'metrics' } });
  check(response, { 'metrics answered': (r) => r.status === 200 }, { route: 'metrics' });
  if (response.status === 200) {
    eventLoopMax.add(response.json('eventLoopDelayMs.max') as number);
  }
  sleep(0.5);
}
