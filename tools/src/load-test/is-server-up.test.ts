import { startHttpServer } from '../test-helpers/http-server';
import { isServerUp } from './is-server-up';

describe('isServerUp', () => {
  it('is true when the server answers', async () => {
    const { port, stop } = await startHttpServer(200);

    expect(await isServerUp(port)).toBe(true);
    await stop();
  });

  it('is false for an error status', async () => {
    const { port, stop } = await startHttpServer(500);

    expect(await isServerUp(port)).toBe(false);
    await stop();
  });

  it('is false when nothing listens on the port', async () => {
    const { port, stop } = await startHttpServer();
    await stop();

    expect(await isServerUp(port)).toBe(false);
  });
});
