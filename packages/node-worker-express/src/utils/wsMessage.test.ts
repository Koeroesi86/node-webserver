import constructWsMessage from './constructWsMessage';
import parseWsMessage from './parseWsMessage';

/** what a client sends: the payload is masked with a key of 4 bytes */
const mask = (text: string, key = Buffer.from([1, 2, 3, 4])) => {
  const payload = Buffer.from(text).map((byte, index) => byte ^ key[index % 4]);
  const length = payload.length < 126 ? Buffer.from([0x80 | payload.length]) : Buffer.from([0x80 | 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([Buffer.from([0x81]), length, key, payload]);
};

describe('constructWsMessage', () => {
  it('frames a short text', () => {
    const message = constructWsMessage('hello');

    expect([...message.subarray(0, 2)]).toEqual([0b10000001, 5]);
    expect(message.subarray(2).toString()).toBe('hello');
  });

  it('frames a text of 126 bytes or more with a 16 bit length', () => {
    const text = 'a'.repeat(300);
    const message = constructWsMessage(text);

    expect([...message.subarray(0, 4)]).toEqual([0b10000001, 126, 300 >> 8, 300 & 255]);
    expect(message.subarray(4).toString()).toBe(text);
  });

  it('measures the length in bytes, not in characters', () => {
    const message = constructWsMessage('ő');

    expect(message[1]).toBe(2);
    expect(message.subarray(2).toString()).toBe('ő');
  });
});

describe('parseWsMessage', () => {
  it('unmasks a short text', () => {
    expect(parseWsMessage(mask('{"received":true}'))).toBe('{"received":true}');
  });

  it('unmasks a text with a 16 bit length', () => {
    const text = 'b'.repeat(200);

    expect(parseWsMessage(mask(text))).toBe(text);
  });
});
