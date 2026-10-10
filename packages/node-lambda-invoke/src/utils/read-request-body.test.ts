import { IncomingMessage } from 'http';
import { Socket } from 'net';
import RequestBodyTooLargeError from '../classes/RequestBodyTooLargeError';
import readRequestBody from './read-request-body';

/** a request whose body arrives in the given parts */
const createRequest = (parts: string[], headers: Record<string, string> = {}) => {
  const request = new IncomingMessage(new Socket());
  Object.assign(request.headers, headers);
  parts.forEach((part) => request.push(part));
  request.push(null);
  return request;
};

describe('readRequestBody', () => {
  it('reads the whole body', async () => {
    expect((await readRequestBody(createRequest(['ab', 'cd']), 0))?.toString()).toBe('abcd');
  });

  it('has no body as undefined', async () => {
    expect(await readRequestBody(createRequest([]), 0)).toBeUndefined();
  });

  it('rejects a body that grows over the limit', async () => {
    await expect(readRequestBody(createRequest(['abc', 'def']), 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('accepts a body of exactly the limit', async () => {
    expect((await readRequestBody(createRequest(['abcd']), 4))?.toString()).toBe('abcd');
  });

  it('rejects at once when the body announces that it is over the limit, without reading it', async () => {
    const request = createRequest(['abcdef'], { 'content-length': '6' });
    const onData = jest.fn();
    request.on('data', onData);
    request.pause();

    await expect(readRequestBody(request, 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(onData).not.toHaveBeenCalled();
  });

  it('rejects when the client goes away before the body is complete', async () => {
    const request = new IncomingMessage(new Socket());
    request.push('ab');
    const body = readRequestBody(request, 0);

    request.destroy();

    await expect(body).rejects.toThrow();
  });
});
