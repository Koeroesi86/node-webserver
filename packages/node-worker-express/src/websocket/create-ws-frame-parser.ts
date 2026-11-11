import { WebSocketCloseCode, WebSocketOpcode } from '../constants';
import WsProtocolError from './ws-protocol-error';

export interface WsFrame {
  fin: boolean;
  opcode: number;
  /** unmasked */
  payload: Buffer;
}

const opcodes: number[] = Object.values(WebSocketOpcode);

const unmask = (payload: Buffer, mask: Buffer) => {
  const unmasked = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) unmasked[index] = payload[index] ^ mask[index & 3];
  return unmasked;
};

/** how many bytes follow the two of the header for a length that does not fit its 7 bits */
const extendedLengthBytes: Record<number, number | undefined> = { 126: 2, 127: 8 };

/** a frame of a client that the connection can not go on with */
const assertValidHeader = (buffer: Buffer) => {
  const opcode = buffer[0] & 0x0f;
  const isControl = opcode >= WebSocketOpcode.close;

  // nothing was negotiated that would use the reserved bits
  if (buffer[0] & 0x70) throw new WsProtocolError(WebSocketCloseCode.protocolError, 'Reserved bits are set.');
  if (!opcodes.includes(opcode)) throw new WsProtocolError(WebSocketCloseCode.protocolError, 'Unknown opcode.');
  if (!(buffer[1] & 0x80)) throw new WsProtocolError(WebSocketCloseCode.protocolError, 'A frame of a client has to be masked.');
  if (isControl && (!(buffer[0] & 0x80) || (buffer[1] & 0x7f) > 125))
    throw new WsProtocolError(WebSocketCloseCode.protocolError, 'A control frame is whole and short.');
};

const readPayloadLength = (buffer: Buffer, lengthBytes: number) => {
  if (lengthBytes === 0) return buffer[1] & 0x7f;
  if (lengthBytes === 2) return buffer.readUInt16BE(2);

  return buffer.readUInt32BE(2) * 2 ** 32 + buffer.readUInt32BE(6);
};

/** the frame at the start of the buffer, or how many bytes are needed to tell more of it */
const readFrame = (buffer: Buffer, maxPayload: number): { frame: WsFrame; length: number } | { needed: number } => {
  if (buffer.length < 2) return { needed: 2 };

  assertValidHeader(buffer);

  const lengthBytes = extendedLengthBytes[buffer[1] & 0x7f] ?? 0;
  const headerLength = 2 + lengthBytes + 4;
  if (buffer.length < headerLength) return { needed: headerLength };

  const payloadLength = readPayloadLength(buffer, lengthBytes);

  // refused from the header, before the payload is waited for
  if (payloadLength > Number.MAX_SAFE_INTEGER || (maxPayload > 0 && payloadLength > maxPayload)) {
    throw new WsProtocolError(WebSocketCloseCode.tooBig, 'The message is too big.');
  }

  const length = headerLength + payloadLength;
  if (buffer.length < length) return { needed: length };

  const mask = buffer.subarray(headerLength - 4, headerLength);
  return {
    frame: {
      fin: Boolean(buffer[0] & 0x80),
      opcode: buffer[0] & 0x0f,
      payload: unmask(buffer.subarray(headerLength, length), mask),
    },
    length,
  };
};

/**
 * Turns the chunks read from a socket into the frames of a websocket client, whatever the way the socket split them: a frame in many chunks and many frames in one chunk.
 * `push` throws a `WsProtocolError` when a frame is not valid, the connection is not to be read after that.
 */
const createWsFrameParser = (maxPayload: number) => {
  /** what was received of the frame that is not complete yet, in the pieces it came in */
  let chunks: Buffer[] = [];
  let size = 0;
  /** how many bytes are needed to go on, once known */
  let needed = 0;

  return (chunk: Buffer): WsFrame[] => {
    chunks.push(chunk);
    size += chunk.length;

    if (size < needed) return [];

    // a frame that came in many chunks is put together once, not each time a chunk arrives
    const buffer = chunks.length === 1 ? chunk : Buffer.concat(chunks, size);
    const frames: WsFrame[] = [];
    let offset = 0;
    let result = readFrame(buffer, maxPayload);

    while ('frame' in result) {
      frames.push(result.frame);
      offset += result.length;
      result = readFrame(buffer.subarray(offset), maxPayload);
    }

    needed = result.needed;
    const rest = buffer.subarray(offset);
    chunks = rest.length > 0 ? [rest] : [];
    size = rest.length;
    return frames;
  };
};

export default createWsFrameParser;
