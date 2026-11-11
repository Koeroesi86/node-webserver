import createWsFrameParser from './create-ws-frame-parser';
import { clientFrame } from './ws-client-frame.test-helper';
import WsProtocolError from './ws-protocol-error';

const text = (frames: ReturnType<ReturnType<typeof createWsFrameParser>>) => frames.map(({ payload }) => payload.toString());

describe('createWsFrameParser', () => {
  it('unmasks a short text', () => {
    expect(text(createWsFrameParser(0)(clientFrame('{"received":true}')))).toEqual(['{"received":true}']);
  });

  it.each([200, 70000])('unmasks a payload of %i bytes', (length) => {
    const payload = Buffer.alloc(length, 'b');

    expect(createWsFrameParser(0)(clientFrame(payload))[0].payload.equals(payload)).toBe(true);
  });

  it('reads many frames from one chunk', () => {
    const frames = createWsFrameParser(0)(Buffer.concat([clientFrame('one'), clientFrame('two'), clientFrame('three')]));

    expect(text(frames)).toEqual(['one', 'two', 'three']);
  });

  it('reads a frame that comes in many chunks, down to single bytes', () => {
    const parse = createWsFrameParser(0);
    const bytes = clientFrame('x'.repeat(300));
    const frames = Array.from(bytes).flatMap((byte) => parse(Buffer.from([byte])));

    expect(text(frames)).toEqual(['x'.repeat(300)]);
  });

  it('keeps the start of the next frame that came with the end of the one before', () => {
    const parse = createWsFrameParser(0);
    const bytes = Buffer.concat([clientFrame('first'), clientFrame('second')]);

    expect(text(parse(bytes.subarray(0, 10)))).toEqual([]);
    expect(text(parse(bytes.subarray(10, 17)))).toEqual(['first']);
    expect(text(parse(bytes.subarray(17)))).toEqual(['second']);
  });

  it('does not take a frame of 8 bytes for the opening of the connection', () => {
    expect(text(createWsFrameParser(0)(clientFrame('hi')))).toEqual(['hi']);
  });

  it('tells the kind and the end of the frame', () => {
    const [frame] = createWsFrameParser(0)(clientFrame('part', { opcode: 0x2, fin: false }));

    expect(frame).toMatchObject({ opcode: 0x2, fin: false });
  });

  it.each([
    ['an unmasked frame', clientFrame('x', { masked: false }), 1002],
    ['reserved bits', Buffer.concat([Buffer.from([0b11000001]), clientFrame('x').subarray(1)]), 1002],
    ['an unknown opcode', clientFrame('x', { opcode: 0x3 }), 1002],
    ['a fragmented control frame', clientFrame('x', { opcode: 0x9, fin: false }), 1002],
    ['a long control frame', clientFrame(Buffer.alloc(126), { opcode: 0x9 }), 1002],
  ])('refuses %s', (_, bytes, code) => {
    expect(() => createWsFrameParser(0)(bytes)).toThrow(expect.objectContaining({ code }));
  });

  it('refuses a payload above the limit from the header, before it has arrived', () => {
    const header = clientFrame(Buffer.alloc(2000)).subarray(0, 8);

    expect(() => createWsFrameParser(1000)(header)).toThrow(expect.objectContaining({ code: 1009 }));
  });

  it('lets a payload at the limit through', () => {
    expect(createWsFrameParser(1000)(clientFrame(Buffer.alloc(1000)))).toHaveLength(1);
  });

  it('refuses a length that no memory could hold', () => {
    const header = Buffer.from([0x81, 0x80 | 127, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4]);

    expect(() => createWsFrameParser(0)(header)).toThrow(WsProtocolError);
  });
});
