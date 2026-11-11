/** the first bytes of a frame: the flags and the opcode, whether the payload is masked, and the length, which takes 1, 3 or 9 bytes from 126 and 65536 bytes */
const constructWsHeader = (firstByte: number, maskBit: number, length: number) => {
  const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const header = Buffer.allocUnsafe(2 + lengthBytes);

  header[0] = firstByte;
  header[1] = maskBit | (lengthBytes === 0 ? length : lengthBytes === 2 ? 126 : 127);
  if (lengthBytes === 2) header.writeUInt16BE(length, 2);
  if (lengthBytes === 8) header.writeBigUInt64BE(BigInt(length), 2);

  return header;
};

export default constructWsHeader;
