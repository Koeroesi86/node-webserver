import { startHttpServer } from '../test-helpers/http-server';
import { requestEndpoint } from './request-endpoint';

describe('requestEndpoint', () => {
  it('is the status of the answer, and sends the host, the method, the path and the body', async () => {
    const { port, requests, stop } = await startHttpServer(201);

    expect(await requestEndpoint(port, { host: 'upload.localhost', path: '/file?x=1', method: 'POST', body: 'content' })).toBe(201);
    expect(requests).toEqual([{ host: 'upload.localhost', method: 'POST', path: '/file?x=1', body: 'content' }]);
    await stop();
  });

  it('asks with GET by default', async () => {
    const { port, requests, stop } = await startHttpServer();
    await requestEndpoint(port, { host: 'web.localhost', path: '/' });

    expect(requests[0].method).toBe('GET');
    await stop();
  });

  it('is undefined when nothing answers', async () => {
    const { port, stop } = await startHttpServer();
    await stop();

    expect(await requestEndpoint(port, { host: 'web.localhost', path: '/' })).toBeUndefined();
  });
});
