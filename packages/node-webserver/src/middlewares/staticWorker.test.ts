import fs from 'fs';
import os from 'os';
import path from 'path';
import staticWorker = require('./staticWorker');
import type { RequestEvent, ResponseEvent } from '@koeroesi86/node-worker-express';

describe('staticWorker', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    jest.useFakeTimers();
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'static-worker-'));
    root = path.join(parent, 'root');
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
    fs.writeFileSync(path.join(parent, 'secret.txt'), 'classified content');
  });

  afterAll(() => {
    jest.useRealTimers();
    fs.rmSync(parent, { recursive: true, force: true });
  });

  const request = (requestPath: string) => {
    let response: ResponseEvent | undefined;
    staticWorker({ httpMethod: 'GET', path: requestPath, rootPath: root, headers: {} } as unknown as RequestEvent, (result) => {
      response = result;
    });

    return response as ResponseEvent;
  };

  it('serves a file', () => {
    const response = request('/index.html');

    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.body ?? '', 'base64').toString()).toBe('<h1>home</h1>');
  });

  it('answers a directory with 404 instead of failing', () => {
    expect(request('/sub').statusCode).toBe(404);
  });

  it.each(['/../secret.txt', '/sub/../../secret.txt', '/....//secret.txt'])('does not serve files outside of the root through %s', (requestPath) => {
    const response = request(requestPath);

    expect(response.statusCode).toBe(404);
    expect(response.body ?? '').not.toContain('classified');
  });

  it('does not reveal the location of the root on a missing file', () => {
    expect(request('/missing.html').body ?? '').not.toContain(root);
  });
});
