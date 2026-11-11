import fs from 'fs';
import os from 'os';
import path from 'path';
import getEntryFiles from './get-entry-files';

describe('getEntryFiles', () => {
  it('gives the root of a worker server and the workers of its routes, relative to the root', () => {
    const files = getEntryFiles({
      hostname: 'a.localhost',
      protocol: 'http',
      type: 'worker',
      options: {
        root: 'site',
        routes: [
          { path: '/api', worker: 'api.js' },
          { path: '/abs', worker: path.resolve('elsewhere/abs.js') },
        ],
      },
    });

    expect(files).toEqual([path.resolve('site'), path.resolve('site/api.js'), path.resolve('elsewhere/abs.js')]);
  });

  it('gives the index files under the root and the static worker of a worker server, also without routes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'get-entry-files-'));
    fs.mkdirSync(path.join(root, 'api'));
    fs.writeFileSync(path.join(root, 'api', 'index.js'), '');
    fs.writeFileSync(path.join(root, 'style.css'), '');

    const files = getEntryFiles({
      hostname: 'a.localhost',
      protocol: 'http',
      type: 'worker',
      options: { root, index: ['index.js'], staticWorker: 'static.js' },
    });
    fs.rmSync(root, { recursive: true });

    expect(files).toEqual([root, path.join(root, 'api', 'index.js'), path.resolve('static.js')]);
  });

  it('gives the lambda of a lambda server and the lambdas of its routes', () => {
    const files = getEntryFiles({
      hostname: 'a.localhost',
      protocol: 'http',
      type: 'lambda',
      lambdaOptions: { lambda: 'build/main.js', routes: [{ path: '/x', lambda: 'build/x.js' }] },
    });

    expect(files).toEqual([path.resolve('build/main.js'), path.resolve('build/x.js')]);
  });

  it('gives nothing for the other types, or a server without options', () => {
    expect(getEntryFiles({ hostname: 'a.localhost', protocol: 'http', type: 'proxy' })).toEqual([]);
    expect(getEntryFiles({ hostname: 'a.localhost', protocol: 'http', type: 'worker' })).toEqual([]);
    expect(getEntryFiles({ hostname: 'a.localhost', protocol: 'http', type: 'lambda', lambdaOptions: { routes: [{ path: '/x', lambda: 'x.js' }] } })).toEqual([
      path.resolve('x.js'),
    ]);
  });
});
