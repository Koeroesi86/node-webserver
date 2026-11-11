import { Readable } from 'stream';
import readBodyStream from './read-body-stream';

describe('readBodyStream', () => {
  it('joins the parts of the body', async () => {
    expect(await readBodyStream(Readable.from([Buffer.from('ab'), Buffer.from('cd')]))).toEqual(Buffer.from('abcd'));
  });

  it('has no bytes for a body without parts', async () => {
    expect(await readBodyStream(Readable.from([]))).toBeUndefined();
  });

  it('rejects with the error the stream ended with, as when the client goes away', async () => {
    const stream = new Readable({ read() {} });
    const read = readBodyStream(stream);

    stream.destroy(new Error('The request was aborted.'));

    await expect(read).rejects.toThrow('The request was aborted.');
  });
});
