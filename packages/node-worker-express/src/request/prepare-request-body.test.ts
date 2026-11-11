import type { IncomingMessage } from 'http';
import prepareRequestBody from './prepare-request-body';

const requestWith = (body: string) => {
  const buffer = Buffer.from(body);
  return { headers: { 'content-length': `${buffer.length}` }, readableLength: buffer.length, read: () => buffer } as unknown as IncomingMessage;
};

describe('prepareRequestBody', () => {
  it('leaves the request alone when the worker has no use for the body', async () => {
    const request = requestWith('abc');

    await expect(prepareRequestBody(request, false, 1000)).resolves.toEqual({ inlineBody: undefined, streamsBody: false });
  });

  it('sends a small body that has arrived along with the request', async () => {
    await expect(prepareRequestBody(requestWith('abc'), true, 1000)).resolves.toEqual({ inlineBody: Buffer.from('abc'), streamsBody: false });
  });

  it('streams a body that is bigger than the limit for the inline one', async () => {
    await expect(prepareRequestBody(requestWith('abc'), true, 2)).resolves.toEqual({ inlineBody: undefined, streamsBody: true });
  });
});
