import createWsReader from './create-ws-reader';
import { clientClose, clientFrame } from './ws-client-frame.test-helper';

describe('createWsReader', () => {
  it('reads a text message as a string', () => {
    expect(createWsReader(0)(clientFrame('hello'))).toEqual([{ type: 'message', data: 'hello' }]);
  });

  it('reads a binary message as a buffer', () => {
    const [event] = createWsReader(0)(clientFrame(Buffer.from([0, 255, 7]), { opcode: 0x2 }));

    expect(event).toEqual({ type: 'message', data: Buffer.from([0, 255, 7]) });
  });

  it('decodes text that is not ASCII', () => {
    expect(createWsReader(0)(clientFrame('árvíztűrő tükörfúrógép 🎉'))).toEqual([{ type: 'message', data: 'árvíztűrő tükörfúrógép 🎉' }]);
  });

  it('joins the fragments of a message, also when a character is cut between them', () => {
    const bytes = Buffer.from('ő');
    const read = createWsReader(0);

    expect(read(clientFrame(bytes.subarray(0, 1), { fin: false }))).toEqual([]);
    expect(read(clientFrame(bytes.subarray(1), { opcode: 0x0 }))).toEqual([{ type: 'message', data: 'ő' }]);
  });

  it('answers a ping between the fragments of a message', () => {
    const read = createWsReader(0);

    expect(read(clientFrame('a', { fin: false }))).toEqual([]);
    expect(read(clientFrame('p', { opcode: 0x9 }))).toEqual([{ type: 'ping', data: Buffer.from('p') }]);
    expect(read(clientFrame('b', { opcode: 0x0 }))).toEqual([{ type: 'message', data: 'ab' }]);
  });

  it('reads a pong', () => {
    expect(createWsReader(0)(clientFrame('', { opcode: 0xa }))).toEqual([{ type: 'pong' }]);
  });

  it('reads the code and the reason of a close', () => {
    expect(createWsReader(0)(clientClose(1001, 'bye'))).toEqual([{ type: 'close', code: 1001, reason: 'bye' }]);
  });

  it('reads a close without a code', () => {
    expect(createWsReader(0)(clientClose())).toEqual([{ type: 'close', reason: '' }]);
  });

  it.each([
    ['text that is not UTF-8', clientFrame(Buffer.from([0xc3, 0x28])), 1007],
    ['a reason that is not UTF-8', clientFrame(Buffer.from([0x03, 0xe8, 0xc3, 0x28]), { opcode: 0x8 }), 1007],
    ['a continuation without a message', clientFrame('x', { opcode: 0x0 }), 1002],
    ['a close code of 1005', clientClose(1005), 1002],
    ['a close of one byte', clientFrame(Buffer.from([3]), { opcode: 0x8 }), 1002],
  ])('refuses %s', (_, bytes, code) => {
    expect(() => createWsReader(0)(bytes)).toThrow(expect.objectContaining({ code }));
  });

  it('refuses a message that starts inside of another one', () => {
    const read = createWsReader(0);
    read(clientFrame('a', { fin: false }));

    expect(() => read(clientFrame('b'))).toThrow(expect.objectContaining({ code: 1002 }));
  });

  it('refuses fragments that make up more than the limit', () => {
    const read = createWsReader(10);
    read(clientFrame('123456', { fin: false }));

    expect(() => read(clientFrame('123456', { opcode: 0x0 }))).toThrow(expect.objectContaining({ code: 1009 }));
  });

  it('lets a message at the limit through', () => {
    expect(createWsReader(10)(clientFrame('1234567890'))).toHaveLength(1);
  });
});
