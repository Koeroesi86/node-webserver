import { Readable } from 'stream';
import streamResponse from './streamResponse';
import type { ResponseEvent } from './types';

const bodyOf = (parts: ResponseEvent[]) => Buffer.concat(parts.map(({ body }) => body).filter(Buffer.isBuffer));

describe('streamResponse', () => {
  /** collects the parts, `acknowledge` decides what the promise of each part resolves to */
  const collect = (acknowledge: (part: number) => unknown = () => true) => {
    const parts: ResponseEvent[] = [];
    const callback = (part: ResponseEvent) => {
      parts.push(part);
      return Promise.resolve(acknowledge(parts.length));
    };

    return { parts, callback };
  };

  async function* generate(...chunks: Array<Buffer | Uint8Array | string>) {
    for (const chunk of chunks) yield chunk;
  }

  it('sends the chunks as parts and ends with a part without a body', async () => {
    const { parts, callback } = collect();

    const completed = await streamResponse(
      callback,
      { statusCode: 201, headers: { 'Content-Type': 'text/plain' } },
      generate('one ', Buffer.from('two '), new Uint8Array(Buffer.from('three')))
    );

    expect(completed).toBe(true);
    expect(bodyOf(parts).toString()).toBe('one two three');
    // the bytes as they are, not a base64 string that the server would have to decode
    expect(parts.slice(0, 3).every(({ body }) => Buffer.isBuffer(body))).toBe(true);
    expect(parts).toHaveLength(4);
    expect(parts[3]).toMatchObject({ emit: true, body: null });
    expect(parts.every((part) => part.emit && part.statusCode === 201 && part.headers['Content-Type'] === 'text/plain')).toBe(true);
  });

  it('answers 200 without headers by default', async () => {
    const { parts, callback } = collect();

    await streamResponse(callback, {}, generate('a'));

    expect(parts[0]).toMatchObject({ statusCode: 200, headers: {} });
  });

  it('keeps the bytes of binary chunks, also of views on a bigger buffer', async () => {
    const { parts, callback } = collect();
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, value) => value));

    await streamResponse(callback, {}, generate(bytes, new Uint8Array(bytes.buffer, bytes.byteOffset + 16, 32)));

    expect(bodyOf(parts)).toEqual(Buffer.concat([bytes, bytes.subarray(16, 48)]));
  });

  it('sends what a chunk held when it was produced, also when the source reuses its buffer', async () => {
    const { parts, callback } = collect();
    async function* reuse() {
      const shared = Buffer.alloc(4);
      for (const letter of ['a', 'b', 'c']) {
        shared.fill(letter);
        yield shared;
      }
    }

    await streamResponse(callback, {}, reuse());

    expect(bodyOf(parts).toString()).toBe('aaaabbbbcccc');
  });

  it('streams a Readable', async () => {
    const { parts, callback } = collect();

    await streamResponse(callback, {}, Readable.from([Buffer.from('a'), Buffer.from('b')]));

    expect(bodyOf(parts).toString()).toBe('ab');
  });

  it('skips empty chunks', async () => {
    const { parts, callback } = collect();

    await streamResponse(callback, {}, generate('a', '', Buffer.alloc(0), 'b'));

    expect(parts).toHaveLength(3);
  });

  it('does not send more parts than the window allows before they are acknowledged', async () => {
    const pending: Array<() => void> = [];
    let sent = 0;
    const done = streamResponse(
      () => {
        sent += 1;
        return new Promise((resolve) => pending.push(() => resolve(true)));
      },
      { window: 3 },
      generate(...Array.from({ length: 10 }, (_, index) => `chunk ${index}`))
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(sent).toBe(3);

    while (pending.length > 0) {
      pending.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(await done).toBe(true);
    expect(sent).toBe(11);
  });

  it('stops when the client is gone, and lets the source clean up', async () => {
    const { parts, callback } = collect((part) => part < 2);
    let cleanedUp = false;
    async function* source() {
      try {
        for (let index = 0; index < 100; index += 1) yield `chunk ${index}`;
      } finally {
        cleanedUp = true;
      }
    }

    const completed = await streamResponse(callback, { window: 1 }, source());

    expect(completed).toBe(false);
    expect(parts.length).toBeLessThan(5);
    expect(parts[parts.length - 1].body).not.toBeNull();
    expect(cleanedUp).toBe(true);
  });

  it('destroys a Readable when the client is gone', async () => {
    const { callback } = collect(() => false);
    const readable = Readable.from(Array.from({ length: 100 }, (_, index) => Buffer.from(`chunk ${index}`)));

    expect(await streamResponse(callback, { window: 1 }, readable)).toBe(false);
    expect(readable.destroyed).toBe(true);
  });

  it('ends the response early when the source fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { parts, callback } = collect();
    async function* failing() {
      yield 'fine';
      throw new Error('broken source');
    }

    const completed = await streamResponse(callback, {}, failing());

    expect(completed).toBe(false);
    expect(bodyOf(parts).toString()).toBe('fine');
    expect(parts[parts.length - 1].body).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not wait for acknowledgements from a callback that returns nothing', async () => {
    const parts: ResponseEvent[] = [];

    await streamResponse((part) => void parts.push(part), {}, generate('a', 'b', 'c', 'd', 'e', 'f'));

    expect(parts).toHaveLength(7);
  });
});
