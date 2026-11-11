import { WebSocketCloseCode, WebSocketOpcode } from '../constants';
import createWsFrameParser from './create-ws-frame-parser';
import type { WsFrame } from './create-ws-frame-parser';
import WsProtocolError from './ws-protocol-error';

export type WsEvent =
  /** a whole message: text is a string, binary a Buffer */
  { type: 'message'; data: string | Buffer } | { type: 'ping'; data: Buffer } | { type: 'pong' } | { type: 'close'; code?: number; reason: string };

/** the codes a peer may send in a close frame: the registered ones, and those for libraries and applications */
const isValidCloseCode = (code: number) => (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const decodeText = (bytes: Buffer) => {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new WsProtocolError(WebSocketCloseCode.invalidData, 'The text is not valid UTF-8.');
  }
};

const readClose = (payload: Buffer): WsEvent => {
  if (payload.length === 0) return { type: 'close', reason: '' };
  if (payload.length === 1) throw new WsProtocolError(WebSocketCloseCode.protocolError, 'A close frame has a code of two bytes.');

  const code = payload.readUInt16BE(0);
  if (!isValidCloseCode(code)) throw new WsProtocolError(WebSocketCloseCode.protocolError, 'The close code is not valid.');

  return { type: 'close', code, reason: decodeText(payload.subarray(2)) };
};

/**
 * Turns the chunks read from the socket of a websocket client into its events: whole messages (fragments joined, text decoded), pings, pongs and the close.
 * A message above `maxMessage` bytes (0 for no limit) or a frame that breaks the protocol throws a `WsProtocolError`, the connection is not to be read after that.
 */
const createWsReader = (maxMessage: number) => {
  const parse = createWsFrameParser(maxMessage);
  /** the pieces of the message that is not complete, and its opcode */
  let fragments: Buffer[] = [];
  let fragmentsSize = 0;
  let fragmentsOpcode: number | undefined;

  const readData = ({ fin, opcode, payload }: WsFrame): WsEvent[] => {
    const isContinuation = opcode === WebSocketOpcode.continuation;
    if (isContinuation === (fragmentsOpcode === undefined)) {
      throw new WsProtocolError(WebSocketCloseCode.protocolError, isContinuation ? 'A continuation without a message.' : 'A message inside of another.');
    }

    fragmentsOpcode ??= opcode;
    fragments.push(payload);
    fragmentsSize += payload.length;
    if (maxMessage > 0 && fragmentsSize > maxMessage) throw new WsProtocolError(WebSocketCloseCode.tooBig, 'The message is too big.');
    if (!fin) return [];

    const bytes = fragments.length === 1 ? payload : Buffer.concat(fragments, fragmentsSize);
    const isText = fragmentsOpcode === WebSocketOpcode.text;
    fragments = [];
    fragmentsSize = 0;
    fragmentsOpcode = undefined;

    return [{ type: 'message', data: isText ? decodeText(bytes) : bytes }];
  };

  const readFrameEvents = (frame: WsFrame): WsEvent[] => {
    if (frame.opcode === WebSocketOpcode.ping) return [{ type: 'ping', data: frame.payload }];
    if (frame.opcode === WebSocketOpcode.pong) return [{ type: 'pong' }];
    if (frame.opcode === WebSocketOpcode.close) return [readClose(frame.payload)];
    return readData(frame);
  };

  return (chunk: Buffer): WsEvent[] => parse(chunk).flatMap(readFrameEvents);
};

export default createWsReader;
