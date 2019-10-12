const DEFAULT_PORTS = {
  http: 80,
  https: 443
};

module.exports.DEFAULT_PORTS = DEFAULT_PORTS;

const PROXY_PROTOCOLS = {
  http: 'http',
  https: 'http',
  ws: 'ws',
  wss: 'ws',
};
module.exports.PROXY_PROTOCOLS = PROXY_PROTOCOLS;

const WORKER_EVENT = {
  REQUEST: 'WORKER_REQUEST',
  REQUEST_ACKNOWLEDGE: 'WORKER_REQUEST_ACK',
  RESPONSE: 'WORKER_RESPONSE',
  RESPONSE_ACKNOWLEDGE: 'WORKER_RESPONSE_ACK',
};
module.exports.WORKER_EVENT = WORKER_EVENT;
