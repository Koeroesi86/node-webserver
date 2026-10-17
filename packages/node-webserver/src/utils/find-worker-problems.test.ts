import fs from 'fs';
import os from 'os';
import path from 'path';
import findWorkerProblems from './find-worker-problems';
import type { ServerConfig } from '../types';

describe('findWorkerProblems', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-problems-'));
    fs.writeFileSync(path.join(root, 'worker.js'), '');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const find = (options: object) =>
    findWorkerProblems({ hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root, ...options } } as ServerConfig, 's').map(
      ({ setting, message }) => `${setting} ${message.replace(root, '<root>')}`
    );

  it('finds nothing for a root, routes and a static worker that are there', () => {
    expect(
      find({
        routes: [
          { path: '/a', worker: 'worker.js' },
          { pattern: '/b/(?<id>.+)', worker: path.join(root, 'worker.js') },
        ],
        staticWorker: path.join(root, 'worker.js'),
      })
    ).toEqual([]);
  });

  it('finds nothing without options, as the schema requires them', () => {
    expect(findWorkerProblems({ hostname: 'a', protocol: 'http', type: 'worker' }, 's')).toEqual([]);
  });

  it('names the folders and files that are not there', () => {
    expect(
      find({
        root: path.join(root, 'none'),
        cwd: path.join(root, 'worker.js'),
        routes: [{ path: '/a', worker: 'gone.js' }],
        staticWorker: path.join(root, 'gone.js'),
      })
    ).toEqual([
      expect.stringContaining('options.root is not a folder'),
      expect.stringContaining('options.cwd is not a folder'),
      expect.stringContaining('options.staticWorker is not a file'),
      expect.stringContaining('options.routes[0].worker is not a file'),
    ]);
  });

  it('names a pattern that is not valid', () => {
    expect(find({ routes: [{ pattern: '(', worker: 'worker.js' }] })).toEqual([
      expect.stringContaining('options.routes[0].pattern Invalid regular expression'),
    ]);
  });
});
