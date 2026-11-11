import constructWsHeader from './construct-ws-header';

describe('constructWsHeader', () => {
  it('puts a length below 126 into the second byte', () => {
    expect(constructWsHeader(0x81, 0, 5)).toEqual(Buffer.from([0x81, 5]));
  });

  it('puts the mask bit in front of the length', () => {
    expect(constructWsHeader(0x81, 0x80, 5)).toEqual(Buffer.from([0x81, 0x85]));
  });

  it('takes two more bytes for a length up to 65535', () => {
    expect(constructWsHeader(0x82, 0, 126)).toEqual(Buffer.from([0x82, 126, 0, 126]));
    expect(constructWsHeader(0x82, 0, 0xffff)).toEqual(Buffer.from([0x82, 126, 0xff, 0xff]));
  });

  it('takes eight more bytes from 65536', () => {
    expect(constructWsHeader(0x82, 0, 0x10000)).toEqual(Buffer.from([0x82, 127, 0, 0, 0, 0, 0, 1, 0, 0]));
  });
});
