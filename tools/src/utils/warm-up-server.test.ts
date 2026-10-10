import { startHttpServer } from '../test-helpers/http-server';
import type { Endpoint } from '../types/warm-up';
import { warmUpServer } from './warm-up-server';

describe('warmUpServer', () => {
  const options = { requests: 5, attempts: 20, intervalMs: 5 };
  const web: Endpoint = { host: 'web.localhost', path: '/' };
  const lambda: Endpoint = { host: 'lambda.localhost', path: '/index.html' };

  it('sends a request to start the endpoint, and then the requests to get it hot', async () => {
    const { port, requests, stop } = await startHttpServer();

    const results = await warmUpServer(port, [web, lambda], options);

    expect(results).toEqual([
      { endpoint: web, ready: true, status: 200 },
      { endpoint: lambda, ready: true, status: 200 },
    ]);
    expect(requests.filter(({ host }) => host === 'web.localhost')).toHaveLength(6);
    expect(requests.filter(({ host }) => host === 'lambda.localhost')).toHaveLength(6);
    await stop();
  });

  it('polls an endpoint whose worker is still starting until it answers', async () => {
    const { port, requests, stop } = await startHttpServer((count) => (count <= 3 ? 503 : 200));

    const results = await warmUpServer(port, [lambda], options);

    expect(results).toEqual([{ endpoint: lambda, ready: true, status: 200 }]);
    // three that were not answered, the one that was, and the requests after it
    expect(requests).toHaveLength(3 + 1 + 5);
    await stop();
  });

  it('takes any answer that is not a server error as ready, a 404 for a missing file is fine', async () => {
    const { port, stop } = await startHttpServer(404);

    expect(await warmUpServer(port, [web], options)).toEqual([{ endpoint: web, ready: true, status: 404 }]);
    await stop();
  });

  it('reports an endpoint that does not answer in time, and does not fail the run', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { port, requests, stop } = await startHttpServer((count, request) => (request.host === 'lambda.localhost' ? 503 : 200));

    const results = await warmUpServer(port, [web, lambda], { ...options, attempts: 3 });

    expect(results).toEqual([
      { endpoint: web, ready: true, status: 200 },
      { endpoint: lambda, ready: false },
    ]);
    expect(requests.filter(({ host }) => host === 'lambda.localhost')).toHaveLength(3);
    expect(error).toHaveBeenCalledWith('warm-up: lambda.localhost/index.html did not answer');
    error.mockRestore();
    await stop();
  });

  it('warms up the endpoints of the load test when it is not told which', async () => {
    const { port, requests, stop } = await startHttpServer();

    await warmUpServer(port, undefined, { ...options, requests: 1 });

    expect(new Set(requests.map(({ host }) => host))).toEqual(
      new Set(['web.localhost', 'lambda.localhost', 'compressed.localhost', 'upload.localhost', 'health.localhost', 'proxied.localhost'])
    );
    expect(requests.find(({ host }) => host === 'upload.localhost')).toMatchObject({ method: 'POST', body: 'warm-up' });
    await stop();
  });
});
