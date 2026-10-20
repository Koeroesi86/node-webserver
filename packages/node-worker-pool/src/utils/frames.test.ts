import crypto from 'crypto';
import { encodeMessage, FrameDecoder } from './frames';
import type { WireMessage } from './frames';

const encoded = (message: WireMessage) => Buffer.concat(encodeMessage(message));

/** the messages that come out when the bytes are fed in pieces of the given size */
const decodeInPieces = (bytes: Buffer, pieceSize: number) => {
  const received: WireMessage[] = [];
  const decoder = new FrameDecoder<WireMessage>((message) => received.push(message));
  for (let offset = 0; offset < bytes.length; offset += pieceSize) {
    decoder.push(bytes.subarray(offset, offset + pieceSize));
  }

  return received;
};

describe('frames', () => {
  describe('encodeMessage', () => {
    it('does not copy the body', () => {
      const body = Buffer.from('payload');

      const parts = encodeMessage({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body } });

      expect(parts).toHaveLength(2);
      expect(parts[1]).toBe(body);
    });

    it('is a single part when there is nothing to send as a body', () => {
      expect(encodeMessage({ type: 'ACK', requestId: 'a' })).toHaveLength(1);
      expect(encodeMessage({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: Buffer.alloc(0) } })).toHaveLength(1);
      expect(encodeMessage({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: '' } })).toHaveLength(1);
    });

    it('does not send the body with the metadata', () => {
      const [head] = encodeMessage({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: 'secret-body-text' } });

      expect(head.toString()).not.toContain('secret-body-text');
    });

    it('leaves the message that was passed in untouched', () => {
      const message = { type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: 'text' } };

      encodeMessage(message);

      expect(message).toEqual({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body: 'text' } });
    });
  });

  describe('FrameDecoder', () => {
    it('decodes a message without an event', () => {
      expect(decodeInPieces(encoded({ type: 'ACK', requestId: 'a' }), 1000)).toEqual([{ type: 'ACK', requestId: 'a' }]);
    });

    it('decodes an event without a body', () => {
      const message = { type: 'REQUEST', requestId: 'a', event: { path: '/', headers: { a: 'b' } } };

      const [received] = decodeInPieces(encoded(message), 1000);

      expect(received).toEqual(message);
      expect(received.event).not.toHaveProperty('body');
    });

    it('keeps a body that was text as text, whatever the characters', () => {
      const body = 'árvíztűrő tükörfúrógép 🚀 "quoted" \n\u0000';

      expect(decodeInPieces(encoded({ type: 'REQUEST', requestId: 'a', event: { path: '/', body } }), 1000)).toEqual([
        { type: 'REQUEST', requestId: 'a', event: { path: '/', body } },
      ]);
    });

    it('keeps an empty text body an empty string', () => {
      const [received] = decodeInPieces(encoded({ type: 'REQUEST', requestId: 'a', event: { body: '' } }), 1000);

      expect(received.event.body).toBe('');
    });

    it('keeps a body that was binary as a buffer with the same bytes', () => {
      const body = crypto.randomBytes(5000);

      const [received] = decodeInPieces(encoded({ type: 'RESPONSE', requestId: 'a', event: { statusCode: 200, body } }), 1000);

      expect(Buffer.isBuffer(received.event.body)).toBe(true);
      expect(received.event.body).toEqual(body);
      expect(received.event).toMatchObject({ statusCode: 200 });
    });

    it('keeps an empty binary body an empty buffer', () => {
      const [received] = decodeInPieces(encoded({ type: 'RESPONSE', requestId: 'a', event: { body: Buffer.alloc(0) } }), 1000);

      expect(received.event.body).toEqual(Buffer.alloc(0));
    });

    it('tells the end of a stream from an empty part', () => {
      const [end, empty] = decodeInPieces(
        Buffer.concat([
          encoded({ type: 'RESPONSE_EMIT', requestId: 'a', event: { emit: true, body: null } }),
          encoded({ type: 'RESPONSE_EMIT', requestId: 'a', event: { emit: true, body: Buffer.alloc(0) } }),
        ]),
        1000
      );

      expect(end.event.body).toBeNull();
      expect(empty.event.body).toEqual(Buffer.alloc(0));
    });

    it('decodes the same messages from any way the stream splits them', () => {
      const messages: WireMessage[] = [
        { type: 'REQUEST', requestId: 'one', event: { path: '/a', body: 'text 🚀' } },
        { type: 'RESPONSE', requestId: 'one', event: { statusCode: 200, headers: { a: 'b' }, body: crypto.randomBytes(300) } },
        { type: 'ACK', requestId: 'one' },
        { type: 'RESPONSE_EMIT', requestId: 'two', event: { emit: true, body: null } },
      ];
      const bytes = Buffer.concat(messages.flatMap((message) => encodeMessage(message)));

      [1, 2, 3, 7, 64, 299, 100000].forEach((pieceSize) => expect(decodeInPieces(bytes, pieceSize)).toEqual(messages));
    });

    it('puts a frame together once instead of each time a chunk arrives', () => {
      const body = crypto.randomBytes(1024 * 1024);
      const bytes = encoded({ type: 'RESPONSE', requestId: 'a', event: { body } });
      const concat = jest.spyOn(Buffer, 'concat');

      const [received] = decodeInPieces(bytes, 16 * 1024);

      // not toEqual, which compares a megabyte byte by byte
      expect(body.equals(Buffer.from(received.event.body))).toBe(true);
      expect(concat.mock.calls.filter(([chunks]) => chunks.length > 1)).toHaveLength(1);
      concat.mockRestore();
    });

    it('waits for the rest of a frame', () => {
      const bytes = encoded({ type: 'ACK', requestId: 'a' });
      const received: WireMessage[] = [];
      const decoder = new FrameDecoder<WireMessage>((message) => received.push(message));

      decoder.push(bytes.subarray(0, bytes.length - 1));
      expect(received).toHaveLength(0);

      decoder.push(bytes.subarray(bytes.length - 1));
      expect(received).toHaveLength(1);
    });

    it('throws when the metadata is longer than the frame', () => {
      const bytes = encoded({ type: 'ACK', requestId: 'a' });
      bytes.writeUInt32LE(1000, 5);

      expect(() => decodeInPieces(bytes, 1000)).toThrow('longer than the frame');
    });

    it('takes a frame as long as the limit', () => {
      const bytes = encoded({ type: 'RESPONSE', requestId: 'a', event: { body: Buffer.alloc(100) } });
      const received: WireMessage[] = [];

      new FrameDecoder<WireMessage>((message) => received.push(message), bytes.length - 4).push(bytes);

      expect(received).toHaveLength(1);
    });

    it('throws on the length of a frame above the limit, without waiting for the frame', () => {
      const bytes = encoded({ type: 'RESPONSE', requestId: 'a', event: { body: Buffer.alloc(100) } });
      const decoder = new FrameDecoder<WireMessage>(() => {}, bytes.length - 5);

      expect(() => decoder.push(bytes.subarray(0, 4))).toThrow('longer than the');
    });

    it('limits a frame to 512 MiB by default', () => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(0xffffffff);

      expect(() => new FrameDecoder<WireMessage>(() => {}).push(length)).toThrow(`longer than the ${512 * 1024 * 1024} allowed`);
    });

    it('throws when the metadata is not JSON', () => {
      const bytes = encoded({ type: 'ACK', requestId: 'a' });
      bytes.write('{{{{', 9);

      expect(() => decodeInPieces(bytes, 1000)).toThrow();
    });
  });
});
