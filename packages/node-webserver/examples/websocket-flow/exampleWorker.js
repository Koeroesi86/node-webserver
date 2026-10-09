const { createHash } = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const clamp = (value, fallback, max) => Math.min(Number.isInteger(value) && value > 0 ? value : fallback, max);

// a websocket for the flow control of the server: it sends every message of the client back, as the same kind of message (after ?delay=<milliseconds>, to be slower than the client), and with ?flood=<messages>&size=<bytes> it sends that
// many binary messages (an index in the first 4 bytes, the rest the index modulo 251) and closes the connection. Both wait for the client to take a message before the next one,
// as a worker that has to keep its memory flat does.
module.exports = async (event, callback) => {
  if (event.protocol !== 'WS') {
    return callback({ statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'A websocket is needed.' });
  }

  if (event.closed) return;

  // a message of the client
  if (event.frame !== undefined || event.binaryFrame !== undefined) {
    const delay = clamp(Number(event.queryStringParameters.delay), 0, 1000);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return callback({ sendWsMessage: true, frame: event.frame ?? event.binaryFrame });
  }

  const key = (event.headers['sec-websocket-key'] || '').trim();
  callback({
    statusCode: 101,
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Accept': createHash('sha1').update(key + GUID).digest('base64') },
    body: '',
  });

  const flood = clamp(Number(event.queryStringParameters.flood), 0, 1000);
  const size = clamp(Number(event.queryStringParameters.size), 65536, 256 * 1024);

  for (let index = 0; index < flood; index += 1) {
    const message = Buffer.alloc(size, index % 251);
    message.writeUInt32BE(index, 0);
    // false when the connection is gone
    if (!(await callback({ sendWsMessage: true, frame: message }))) return;
  }

  if (flood > 0) callback({ sendWsMessage: true, close: { code: 1000, reason: 'done' } });
};
