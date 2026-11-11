import { WebSocketOpcode } from '../constants';
import constructWsFrame from './construct-ws-frame';

/** a control frame holds 125 bytes at most, a reason that does not fit is left out rather than cut in the middle of a character */
const constructWsCloseFrame = (code?: number, reason = '') => {
  if (code === undefined) return constructWsFrame(WebSocketOpcode.close);

  const codeBytes = Buffer.alloc(2);
  codeBytes.writeUInt16BE(code);

  return constructWsFrame(WebSocketOpcode.close, Buffer.concat([codeBytes, Buffer.byteLength(reason) <= 123 ? Buffer.from(reason) : Buffer.alloc(0)]));
};

export default constructWsCloseFrame;
