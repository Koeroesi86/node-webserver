import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import staticWorker from './staticWorker';
import type { RequestEvent, ResponseEvent } from './types';

describe('staticWorker', () => {
  let parent: string;
  let root: string;

  beforeAll(async () => {
    jest.useFakeTimers();
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'static-worker-'));
    root = path.join(parent, 'root');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'index.html'), '<h1>home</h1>');
    await fs.writeFile(path.join(root, 'a..b.txt'), 'dots');
    await fs.writeFile(path.join(parent, 'secret.txt'), 'classified content');
  });

  afterAll(async () => {
    jest.useRealTimers();
    await fs.rm(parent, { recursive: true, force: true });
  });

  const request = (requestPath: string, httpMethod = 'GET') =>
    new Promise<ResponseEvent>((resolve) => {
      const event = { httpMethod, path: requestPath, rootPath: root, headers: {} } as RequestEvent;
      staticWorker(event, resolve);
    });
  const bodyOf = ({ body, isBase64Encoded }: ResponseEvent) => Buffer.from(body, isBase64Encoded ? 'base64' : 'utf8').toString();

  it('serves a file', async () => {
    const response = await request('/index.html');

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toBe('<h1>home</h1>');
  });

  it('serves the index file of a path ending with a slash', async () => {
    expect((await request('/')).statusCode).toBe(200);
  });

  it('serves file names containing dots', async () => {
    expect(bodyOf(await request('/a..b.txt'))).toBe('dots');
  });

  it('answers a directory with 404 instead of failing', async () => {
    expect((await request('/sub')).statusCode).toBe(404);
  });

  it('answers a missing file with 404', async () => {
    expect((await request('/missing.html')).statusCode).toBe(404);
  });

  it.each(['/../secret.txt', '/sub/../../secret.txt', '/....//secret.txt'])('does not serve files outside of the root through %s', async (requestPath) => {
    const response = await request(requestPath);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('classified');
  });

  it('does not serve other methods than GET and HEAD', async () => {
    expect((await request('/index.html', 'POST')).statusCode).toBe(404);
  });
});
