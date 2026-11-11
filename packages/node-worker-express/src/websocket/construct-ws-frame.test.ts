import constructWsCloseFrame from './construct-ws-close-frame';
import constructWsFrame from './construct-ws-frame';

describe('constructWsFrame', () => {
  it('frames a short text', () => {
    const frame = constructWsFrame(0x1, 'hello');

    expect([...frame.subarray(0, 2)]).toEqual([0b10000001, 5]);
    expect(frame.subarray(2).toString()).toBe('hello');
  });

  it('measures the length in bytes, not in characters', () => {
    const frame = constructWsFrame(0x1, 'ő');

    expect(frame[1]).toBe(2);
    expect(frame.subarray(2).toString()).toBe('ő');
  });

  it('frames a payload of 126 bytes or more with a 16 bit length', () => {
    const frame = constructWsFrame(0x1, 'a'.repeat(300));

    expect([...frame.subarray(0, 4)]).toEqual([0b10000001, 126, 300 >> 8, 300 & 255]);
    expect(frame.subarray(4).toString()).toBe('a'.repeat(300));
  });

  it('frames a payload above 65535 bytes with a 64 bit length', () => {
    const payload = Buffer.alloc(70000, 3);
    const frame = constructWsFrame(0x2, payload);

    expect([...frame.subarray(0, 2)]).toEqual([0b10000010, 127]);
    expect(frame.readBigUInt64BE(2)).toBe(70000n);
    expect(frame.subarray(10).equals(payload)).toBe(true);
  });

  it('frames the longest payload of the 16 bit length with it', () => {
    expect(constructWsFrame(0x2, Buffer.alloc(65535))[1]).toBe(126);
    expect(constructWsFrame(0x2, Buffer.alloc(65536))[1]).toBe(127);
  });

  it('frames without a payload', () => {
    expect([...constructWsFrame(0x9)]).toEqual([0b10001001, 0]);
  });
});

describe('constructWsCloseFrame', () => {
  it('has the code and the reason', () => {
    const frame = constructWsCloseFrame(1001, 'bye');

    expect(frame[0]).toBe(0b10001000);
    expect(frame.readUInt16BE(2)).toBe(1001);
    expect(frame.subarray(4).toString()).toBe('bye');
  });

  it('has no payload without a code', () => {
    expect([...constructWsCloseFrame()]).toEqual([0b10001000, 0]);
  });

  it('leaves out a reason that does not fit in a control frame', () => {
    const frame = constructWsCloseFrame(1000, 'ő'.repeat(100));

    expect(frame[1]).toBe(2);
  });
});
