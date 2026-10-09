/** a frame as the server sends it, which is not masked. Lengths from 126 bytes need two bytes, and from 65536 bytes eight. */
const constructWsFrame = (opcode: number, payload: Buffer | string = Buffer.alloc(0)) => {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const lengthBytes = body.length < 126 ? 0 : body.length <= 0xffff ? 2 : 8;
  const header = Buffer.allocUnsafe(2 + lengthBytes);

  header[0] = 0x80 | opcode;
  header[1] = lengthBytes === 0 ? body.length : lengthBytes === 2 ? 126 : 127;
  if (lengthBytes === 2) header.writeUInt16BE(body.length, 2);
  if (lengthBytes === 8) header.writeBigUInt64BE(BigInt(body.length), 2);

  return Buffer.concat([header, body]);
};

export default constructWsFrame;
