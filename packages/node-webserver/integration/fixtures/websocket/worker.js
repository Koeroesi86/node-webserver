const { createHash } = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// accepts the upgrade and sends every message back as it came, text as text and binary as binary
module.exports = async (event, callback) => {
  if (event.closed) return;

  if (event.frame === undefined && event.binaryFrame === undefined) {
    const key = (event.headers['sec-websocket-key'] || '').trim();
    callback({
      statusCode: 101,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Accept': createHash('sha1').update(key + GUID).digest('base64') },
      body: '',
    });
    // waits for the client to take every message, so that it is never more than a few of them ahead
    for (let index = 0; event.path === '/flood' && index < 200; index += 1) {
      if (!(await callback({ sendWsMessage: true, frame: `${index}:${'x'.repeat(64 * 1024)}` }))) return;
    }
    return;
  }

  await callback({ sendWsMessage: true, frame: event.frame ?? event.binaryFrame });
};
