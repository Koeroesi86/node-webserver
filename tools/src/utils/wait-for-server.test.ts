import { createServer } from 'node:http';
import { startHttpServer } from '../test-helpers/http-server';
import { waitForServer } from './wait-for-server';

describe('waitForServer', () => {
  /** a port that nothing listens on */
  const freePort = async () => {
    const { port, stop } = await startHttpServer();
    await stop();

    return port;
  };

  it('returns as soon as the server answers', async () => {
    const { port, stop } = await startHttpServer();

    await expect(waitForServer(port, 3, 10)).resolves.toBeUndefined();
    await stop();
  });

  it('waits for a server that starts late', async () => {
    const port = await freePort();
    const server = createServer((request, response) => response.end('ok'));
    setTimeout(() => server.listen(Number(port)), 100);

    await waitForServer(port, 50, 20);

    expect(server.listening).toBe(true);
    await new Promise((done) => server.close(done));
  });

  it('gives up after the attempts when nothing answers', async () => {
    await expect(waitForServer(await freePort(), 2, 5)).resolves.toBeUndefined();
  });
});
