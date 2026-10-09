import crypto from 'crypto';
import http from 'http';
import https from 'https';
import type { Socket } from 'net';

export interface WebSocketClient {
  /** the answer to the upgrade */
  status: number;
  send: (data: string | Buffer) => void;
  ping: (data: string) => void;
  /** the next message, ping, pong or close the server sent */
  next: () => Promise<{ opcode: number; payload: Buffer }>;
  closed: Promise<void>;
  close: () => void;
  /** stops reading from the socket, what the server sends piles up */
  pause: () => void;
  resume: () => void;
  /** the bytes the socket has taken from the server and not handed on */
  buffered: () => number;
}

/** a frame as a client sends it: masked, with the length in 1, 3 or 9 bytes */
const frame = (opcode: number, payload: Buffer) => {
  const mask = crypto.randomBytes(4);
  const lengthBytes = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
  const header = Buffer.alloc(2 + lengthBytes);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | (lengthBytes === 0 ? payload.length : lengthBytes === 2 ? 126 : 127);
  if (lengthBytes === 2) header.writeUInt16BE(payload.length, 2);
  if (lengthBytes === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, mask, payload.map((byte, index) => byte ^ mask[index % 4])]);
};

/** reads the frames of the server, which are not masked */
const readFrames = (buffer: Buffer): { frames: Array<{ opcode: number; payload: Buffer }>; rest: Buffer } => {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const code = buffer[offset + 1] & 0x7f;
    const headerLength = 2 + (code === 126 ? 2 : code === 127 ? 8 : 0);
    if (buffer.length - offset < headerLength) break;
    const length = code === 126 ? buffer.readUInt16BE(offset + 2) : code === 127 ? Number(buffer.readBigUInt64BE(offset + 2)) : code;
    if (buffer.length - offset < headerLength + length) break;
    frames.push({ opcode: buffer[offset] & 0x0f, payload: buffer.subarray(offset + headerLength, offset + headerLength + length) });
    offset += headerLength + length;
  }
  return { frames, rest: buffer.subarray(offset) };
};

/** opens a websocket to a virtual host of the server on the loopback address, over TLS with `secure` */
export const connectWebSocket = ({ port, host, path = '/', secure = false }: { port: number; host: string; path?: string; secure?: boolean }) =>
  new Promise<WebSocketClient>((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const outgoing = (secure ? https : http).request({
      host: '127.0.0.1',
      port,
      path,
      agent: false,
      // the certificate is self signed, the name below localhost is the one to ask the server for
      ...(secure && { servername: host, rejectUnauthorized: false }),
      headers: { Host: host, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    outgoing.on('error', reject);
    outgoing.on('response', (response) => {
      response.resume();
      resolve({
        status: response.statusCode ?? 0,
        send: () => {},
        ping: () => {},
        next: () => Promise.reject(new Error('No connection.')),
        closed: Promise.resolve(),
        close: () => {},
        pause: () => {},
        resume: () => {},
        buffered: () => 0,
      });
    });
    outgoing.on('upgrade', (response, socket: Socket, head: Buffer) => {
      const queue: Array<{ opcode: number; payload: Buffer }> = [];
      const waiting: Array<(message: { opcode: number; payload: Buffer }) => void> = [];
      let pending: Buffer = Buffer.alloc(0);
      const take = (chunk: Buffer) => {
        const { frames, rest } = readFrames(Buffer.concat([pending, chunk]));
        pending = rest;
        frames.forEach((message) => (waiting.shift() ?? ((value) => queue.push(value)))(message));
      };
      socket.on('data', take);
      socket.on('error', () => {});
      take(head);

      resolve({
        status: response.statusCode ?? 0,
        send: (data) => socket.write(typeof data === 'string' ? frame(0x1, Buffer.from(data)) : frame(0x2, data)),
        ping: (data) => socket.write(frame(0x9, Buffer.from(data))),
        next: () => {
          const message = queue.shift();
          return message ? Promise.resolve(message) : new Promise((done) => waiting.push(done));
        },
        closed: new Promise<void>((done) => socket.on('close', () => done())),
        close: () => socket.destroy(),
        pause: () => socket.pause(),
        resume: () => socket.resume(),
        buffered: () => socket.readableLength,
      });
    });
    outgoing.end();
  });
