/** a frame as a client sends it: the payload is masked with a key of 4 bytes, and the length takes 1, 3 or 9 bytes */
export const clientFrame = (payload: Buffer | string = '', { opcode = 0x1, fin = true, mask = Buffer.from([1, 2, 3, 4]), masked = true } = {}) => {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const lengthBytes = body.length < 126 ? 0 : body.length <= 0xffff ? 2 : 8;
  const header = Buffer.alloc(2 + lengthBytes);

  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = (masked ? 0x80 : 0) | (lengthBytes === 0 ? body.length : lengthBytes === 2 ? 126 : 127);
  if (lengthBytes === 2) header.writeUInt16BE(body.length, 2);
  if (lengthBytes === 8) header.writeBigUInt64BE(BigInt(body.length), 2);

  return Buffer.concat([header, ...(masked ? [mask] : []), masked ? Buffer.from(body.map((byte, index) => byte ^ mask[index % 4])) : body]);
};

/** a close frame of a client */
export const clientClose = (code?: number, reason = '') => {
  const payload = code === undefined ? Buffer.alloc(0) : Buffer.concat([Buffer.from([code >> 8, code & 255]), Buffer.from(reason)]);
  return clientFrame(payload, { opcode: 0x8 });
};
