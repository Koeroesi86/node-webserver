import http from 'k6/http';
import ws from 'k6/ws';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// The flow control of websockets, which the example load test does not measure: a client that sends faster than the worker handles messages, and a client that reads slower than the worker sends.
// Both have to get every message, whole and in order, and the memory of the server has to stay flat (the worker waits for the client to take a message before it sends the next one).
// Run on its own and not part of the comparison with the base, as a base without the route would answer it with fast errors and look better for it.
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const hostname = __ENV.HOSTNAME_HEADER || 'web.localhost';
const healthHostname = 'health.localhost';
const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/websocket-flow/exampleWorker.js`;
const producedMessages = Number(__ENV.PRODUCED_MESSAGES || 400);
const producedSize = 32 * 1024;
// how long the worker takes for each of them, in milliseconds: it is slower than the client
const workerDelay = Number(__ENV.WORKER_DELAY_MS || 2);
const floodMessages = Number(__ENV.FLOOD_MESSAGES || 200);
const floodSize = 64 * 1024;
// how long the slow consumer takes for each message, in milliseconds
const consumerDelay = Number(__ENV.CONSUMER_DELAY_MS || 5);
// the most memory outside of the heap (the buffers, where the messages wait) that the server may hold at any time of the run, in MiB. Without flow control the messages the worker produces
// pile up in it: a client that reads slowly leaves megabytes unread, every one of the clients does.
const maxExternal = Number(__ENV.MAX_EXTERNAL_MIB || 100);
const external = new Trend('ws_flow_server_external_mib');
const rss = new Trend('ws_flow_server_rss_mib');
const sessionOk = new Rate('ws_flow_session_ok');
const binary = new Uint8Array(producedSize).map((_, index) => (index * 31) % 251).buffer;
const binarySha256 = crypto.sha256(binary, 'hex');

export const options = {
  scenarios: {
    fastProducer: { executor: 'constant-vus', exec: 'fastProducer', vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || '15s' },
    slowConsumer: { executor: 'constant-vus', exec: 'slowConsumer', vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || '15s' },
    memory: { executor: 'constant-vus', exec: 'sampleMemory', vus: 1, duration: __ENV.DURATION || '15s' },
  },
  thresholds: {
    checks: ['rate>0.999'],
    ws_flow_session_ok: ['rate>0.999'],
    ws_flow_server_external_mib: [`max<${maxExternal}`],
  },
};

/** the server asks itself, through the worker of the health route */
export function sampleMemory() {
  const response = http.get(`${baseUrl}/metrics`, { headers: { Host: healthHostname }, tags: { route: 'metrics' } });
  check(response, { 'metrics answered': (r) => r.status === 200 }, { route: 'metrics' });
  if (response.status === 200) {
    external.add((response.json('memory.external') as number) / (1024 * 1024));
    rss.add((response.json('memory.rss') as number) / (1024 * 1024));
  }
  sleep(0.1);
}

const connect = (route: string, query: string, handlers: (socket: ws.Socket) => void) => {
  const response = ws.connect(`${wsUrl}${query}`, { headers: { Host: hostname }, tags: { route } }, (socket) => {
    handlers(socket);
    // a run that stalls ends here, and fails the checks of its session
    socket.setTimeout(() => socket.close(), 30000);
  });
  check(response, { [`${route} upgraded`]: (r) => r && r.status === 101 }, { route });
};

/** sends the messages faster than the worker handles them, and reads what comes back: text and binary, in the order they were sent */
export function fastProducer() {
  // the text of each message that was sent, undefined for a binary one
  const sent: Array<string | undefined> = [];
  let received = 0;
  let valid = true;

  connect('wsFastProducer', `?delay=${workerDelay}`, (socket) => {
    socket.on('open', () => {
      for (let index = 0; index < producedMessages; index += 1) {
        // every fourth message is binary
        const text = index % 4 === 3 ? undefined : `${index}:${'ő'.repeat(producedSize / 2)}`;
        sent.push(text);
        if (text === undefined) socket.sendBinary(binary);
        else socket.send(text);
      }
    });
    const take = (matches: boolean) => {
      valid = valid && matches;
      received += 1;
      if (received === producedMessages) socket.close();
    };
    socket.on('message', (data) => {
      take(sent[received] !== undefined && data === sent[received]);
    });
    socket.on('binaryMessage', (data) => {
      take(received < sent.length && sent[received] === undefined && data.byteLength === producedSize && crypto.sha256(data, 'hex') === binarySha256);
    });
  });

  const ok = received === producedMessages && valid;
  check(null, { 'fast producer got every message back, in order': () => ok }, { route: 'wsFastProducer' });
  sessionOk.add(ok);
}

/** reads slower than the worker sends: every message has to arrive whole and in order, and the connection ends with the close of the worker */
export function slowConsumer() {
  let received = 0;
  let valid = true;
  let code: number | undefined;

  connect('wsSlowConsumer', `?flood=${floodMessages}&size=${floodSize}`, (socket) => {
    socket.on('binaryMessage', (data) => {
      const view = new DataView(data);
      valid = valid && data.byteLength === floodSize && view.getUint32(0) === received && view.getUint8(floodSize - 1) === received % 251;
      received += 1;
      // k6 cannot stop reading, so the delay is spent in the handler
      const until = Date.now() + consumerDelay;
      while (Date.now() < until);
    });
    socket.on('close', (closeCode) => {
      code = closeCode;
    });
  });

  const ok = received === floodMessages && valid && code === 1000;
  check(null, { 'slow consumer got every message, in order, and a normal close': () => ok }, { route: 'wsSlowConsumer' });
  sessionOk.add(ok);
}
