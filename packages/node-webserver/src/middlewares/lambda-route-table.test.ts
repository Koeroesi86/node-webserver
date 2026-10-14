import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HttpMiddleware } from '@koeroesi86/node-lambda-invoke';
import createLambdaRouteTable from './lambda-route-table';

describe('createLambdaRouteTable', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-route-table-'));
  const lambda = path.join(folder, 'a.js');
  const createTarget = (): HttpMiddleware => ({ handle: jest.fn(), close: jest.fn() }) as unknown as HttpMiddleware;

  beforeAll(() => fs.writeFileSync(lambda, ''));
  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('starts a target per route and matches a request path to it', () => {
    const started: HttpMiddleware[] = [];

    const match = createLambdaRouteTable([{ path: '/api', lambda }], createTarget, started);

    expect(started).toHaveLength(1);
    expect(match('/api')?.target).toBe(started[0]);
    expect(match('/other')).toBeUndefined();
  });

  it('rejects a route without a lambda before a target is started', () => {
    const createTargetSpy = jest.fn(createTarget);

    expect(() => createLambdaRouteTable([{ path: '/api', lambda: '' }], createTargetSpy, [])).toThrow('routes[0] has no lambda.');
    expect(createTargetSpy).not.toHaveBeenCalled();
  });

  it('rejects a lambda that is not a file', () => {
    expect(() => createLambdaRouteTable([{ path: '/api', lambda: folder }], createTarget, [])).toThrow(`The lambda of routes[0] is not a file: ${folder}`);
  });

  it('keeps the targets started before a route that fails, so that they can be closed', () => {
    const started: HttpMiddleware[] = [];

    expect(() =>
      createLambdaRouteTable(
        [
          { path: '/api', lambda },
          { path: '/b', lambda: path.join(folder, 'missing.js') },
        ],
        createTarget,
        started
      )
    ).toThrow('routes[1]');
    expect(started).toHaveLength(1);
  });
});
