import constructWsHeader from './construct-ws-header';

/** a frame as the server sends it, which is not masked. Lengths from 126 bytes need two bytes, and from 65536 bytes eight. */
const constructWsFrame = (opcode: number, payload: Buffer | string = Buffer.alloc(0)) => {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;

  return Buffer.concat([constructWsHeader(0x80 | opcode, 0, body.length), body]);
};

export default constructWsFrame;
