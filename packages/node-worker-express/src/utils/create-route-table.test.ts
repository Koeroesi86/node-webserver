import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { RoutePathLimit } from '../constants';
import createRouteTable from './create-route-table';

describe('createRouteTable', () => {
  let folder: string;
  let root: string;
  let items: string;
  let other: string;
  let outside: string;

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'route-table-'));
    root = path.join(folder, 'root');
    await fs.mkdir(path.join(root, 'workers'), { recursive: true });
    items = path.join(root, 'workers', 'items.js');
    other = path.join(root, 'workers', 'other.js');
    outside = path.join(folder, 'outside.js');
    await Promise.all([items, other, outside].map((file) => fs.writeFile(file, '')));
  });

  afterAll(() => fs.rm(folder, { recursive: true, force: true }));

  it('finds the worker of a path', () => {
    const findRoute = createRouteTable(root, [{ path: '/items', worker: 'workers/items.js' }]);

    expect(findRoute('/items')).toEqual({ worker: items });
    expect(findRoute('/items/')).toBeUndefined();
    expect(findRoute('/other')).toBeUndefined();
  });

  it('matches a pattern against the whole path', () => {
    const findRoute = createRouteTable(root, [{ pattern: '/items/[0-9]+', worker: 'workers/items.js' }]);

    expect(findRoute('/items/12')).toEqual({ worker: items });
    expect(findRoute('/items/12/more')).toBeUndefined();
    expect(findRoute('/prefix/items/12')).toBeUndefined();
  });

  it('hands the named groups on as path parameters, leaving out the ones that took no part', () => {
    const findRoute = createRouteTable(root, [{ pattern: '/items/(?<id>[0-9]+)(?:/(?<part>[a-z]+))?', worker: 'workers/items.js' }]);

    expect(findRoute('/items/12/name')).toEqual({ worker: items, pathParameters: { id: '12', part: 'name' } });
    expect(findRoute('/items/12')).toEqual({ worker: items, pathParameters: { id: '12' } });
  });

  it('uses the flags of a pattern', () => {
    const findRoute = createRouteTable(root, [{ pattern: '/items', flags: 'i', worker: 'workers/items.js' }]);

    expect(findRoute('/ITEMS')).toEqual({ worker: items });
  });

  it('takes the first route that matches, a path as well as a pattern', () => {
    const patternFirst = createRouteTable(root, [
      { pattern: '/items/.*', worker: 'workers/items.js' },
      { path: '/items/12', worker: 'workers/other.js' },
    ]);
    const pathFirst = createRouteTable(root, [
      { path: '/items/12', worker: 'workers/other.js' },
      { pattern: '/items/.*', worker: 'workers/items.js' },
      { path: '/items/12', worker: 'workers/items.js' },
    ]);

    expect(patternFirst('/items/12')).toEqual({ worker: items });
    expect(pathFirst('/items/12')).toEqual({ worker: other });
    expect(pathFirst('/items/13')).toEqual({ worker: items });
  });

  it('always uses the worker of the route, whatever the path captured', () => {
    const findRoute = createRouteTable(root, [{ pattern: '/run/(?<worker>.+)', worker: 'workers/items.js' }]);

    expect(findRoute('/run/../../outside.js')).toEqual({ worker: items, pathParameters: { worker: '../../outside.js' } });
    expect(findRoute('/run/%2e%2e/outside.js')?.worker).toBe(items);
  });

  it('runs workers outside of the root', () => {
    const findRoute = createRouteTable(root, [
      { path: '/relative', worker: '../outside.js' },
      { path: '/absolute', worker: outside },
    ]);

    expect(findRoute('/relative')).toEqual({ worker: outside });
    expect(findRoute('/absolute')).toEqual({ worker: outside });
  });

  it('matches no path that is longer than the limit', () => {
    const findRoute = createRouteTable(root, [{ pattern: '/.*', worker: 'workers/items.js' }]);

    expect(findRoute(`/${'a'.repeat(RoutePathLimit - 1)}`)).toEqual({ worker: items });
    expect(findRoute(`/${'a'.repeat(RoutePathLimit)}`)).toBeUndefined();
  });

  it('matches nothing without routes', () => {
    expect(createRouteTable(root, [])('/')).toBeUndefined();
  });

  describe('refuses a route', () => {
    it.each([
      ['without a worker', { path: '/items', worker: '' }, /has no worker/],
      ['whose worker is missing', { path: '/items', worker: 'workers/missing.js' }, /is not a file/],
      ['whose worker is a folder', { path: '/items', worker: 'workers' }, /is not a file/],
      ['with a path not starting with /', { path: 'items', worker: 'workers/items.js' }, /has to start with \//],
      ['with a path longer than the limit', { path: `/${'a'.repeat(RoutePathLimit)}`, worker: 'workers/items.js' }, /at most/],
      ['with an invalid pattern', { pattern: '/items/(', worker: 'workers/items.js' }, /pattern of routes\[0\] is not valid/],
      // it would undo the anchors once it is wrapped in them
      ['with a pattern that closes the group around it', { pattern: '/a)|(.*', worker: 'workers/items.js' }, /pattern of routes\[0\] is not valid/],
      ['with a flag that keeps a state', { pattern: '/items', flags: 'g', worker: 'workers/items.js' }, /has the flag g/],
      ['with both a path and a pattern', { path: '/items', pattern: '/items', worker: 'workers/items.js' }, /both a path and a pattern/],
      ['with neither a path nor a pattern', { worker: 'workers/items.js' }, /needs a path or a pattern/],
    ])('%s', (_, route, message) => {
      // the configuration is JSON, so what the types rule out can still come
      expect(() => createRouteTable(root, JSON.parse(JSON.stringify([route])))).toThrow(message);
    });
  });
});
