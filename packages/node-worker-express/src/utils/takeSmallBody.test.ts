import { PassThrough } from 'stream';
import takeSmallBody from './takeSmallBody';
import type { IncomingMessage } from 'http';

/** a request that has received the given chunks, with the length it announced (if any), and whether the parser has seen the end of it */
const request = (chunks: Buffer[], { length, complete = false }: { length?: number; complete?: boolean } = {}) => {
  const stream = new PassThrough();
  chunks.forEach((chunk) => stream.write(chunk));

  return Object.assign(stream, { complete, headers: length === undefined ? {} : { 'content-length': String(length) } }) as unknown as IncomingMessage;
};

describe('takeSmallBody', () => {
  describe('a body with a length', () => {
    it('is taken when that many bytes have arrived, whatever the chunks they came in and before the parser is done', () => {
      expect(takeSmallBody(request([Buffer.from('hello '), Buffer.from('world')], { length: 11 }), 100)).toEqual(Buffer.from('hello world'));
    });

    it('is taken as the bytes it has', () => {
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));

      expect(takeSmallBody(request([bytes], { length: 256 }), 1000)).toEqual(bytes);
    });

    it('is not taken while bytes are missing', () => {
      expect(takeSmallBody(request([Buffer.from('part')], { length: 11 }), 100)).toBeUndefined();
    });

    it('is of no bytes when it announces none, and needs nothing to have arrived', () => {
      expect(takeSmallBody(request([], { length: 0 }), 100)).toEqual(Buffer.alloc(0));
    });

    it('is taken when it is exactly as big as the limit, and not when it is a byte bigger', () => {
      expect(takeSmallBody(request([Buffer.alloc(100)], { length: 100 }), 100)).toHaveLength(100);
      expect(takeSmallBody(request([Buffer.alloc(101)], { length: 101 }), 100)).toBeUndefined();
    });

    it('is not taken when it is bigger than the limit, even if all of it has arrived', () => {
      expect(takeSmallBody(request([Buffer.alloc(500)], { length: 500, complete: true }), 100)).toBeUndefined();
    });

    it('takes no more than its length', () => {
      const received = request([Buffer.from('bodyEXTRA')], { length: 4 });

      expect(takeSmallBody(received, 100)).toEqual(Buffer.from('body'));
      expect(received.read()).toEqual(Buffer.from('EXTRA'));
    });

    it('is not trusted when the length is not a number', () => {
      const received = request([Buffer.from('abc')], { complete: false });
      received.headers['content-length'] = 'many';

      expect(takeSmallBody(received, 100)).toBeUndefined();
    });
  });

  describe('a body without a length', () => {
    it('is taken once the parser has seen the end of it', () => {
      expect(takeSmallBody(request([Buffer.from('chunk one '), Buffer.from('chunk two')], { complete: true }), 100)).toEqual(
        Buffer.from('chunk one chunk two')
      );
    });

    it('is not taken while it can still grow, however small it is so far', () => {
      expect(takeSmallBody(request([Buffer.from('part')], { complete: false }), 100)).toBeUndefined();
    });

    it('is of no bytes when nothing came and it is complete', () => {
      expect(takeSmallBody(request([], { complete: true }), 100)).toEqual(Buffer.alloc(0));
    });

    it('is not taken when it is bigger than the limit', () => {
      expect(takeSmallBody(request([Buffer.alloc(101)], { complete: true }), 100)).toBeUndefined();
    });
  });

  it('takes none with a limit of 0', () => {
    expect(takeSmallBody(request([], { length: 0 }), 0)).toBeUndefined();
  });

  it('leaves the body in the request when it does not take it, to be read as usual', () => {
    const big = request([Buffer.alloc(500, 7)], { length: 500 });

    expect(takeSmallBody(big, 100)).toBeUndefined();
    expect(big.read()).toEqual(Buffer.alloc(500, 7));
  });

  it('takes the body out, so it is not read twice', () => {
    const small = request([Buffer.from('once')], { length: 4 });

    takeSmallBody(small, 100);

    expect(small.read()).toBeNull();
  });
});
