import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import os from 'os';
import path from 'path';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import lambdaMiddleware from './lambda';
import type { ServerInstance } from '../types';

jest.mock('@koeroesi86/node-lambda-invoke', () => ({ httpMiddleware: jest.fn(() => 'the handler') }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { info: jest.fn() } }));

const instance = (lambdaOptions: ServerInstance['lambdaOptions']): ServerInstance => ({
  hostname: 'lambda.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions,
});

describe('lambdaMiddleware', () => {
  beforeEach(() => {
    jest.mocked(httpMiddleware).mockClear();
  });

  it('calls the middleware of the library with its options object, not with positional arguments', () => {
    const handler = lambdaMiddleware(instance({ lambda: '/lambdas/a.js', handler: 'main' }));

    expect(handler).toBe('the handler');
    expect(httpMiddleware).toHaveBeenCalledTimes(1);
    expect(jest.mocked(httpMiddleware).mock.calls[0]).toHaveLength(1);
    expect(jest.mocked(httpMiddleware).mock.calls[0][0]).toMatchObject({ lambdaPath: '/lambdas/a.js', handlerKey: 'main', logger: expect.any(Function) });
  });

  it('uses the handler key `handler` and the communication `ipc` unless told otherwise', () => {
    lambdaMiddleware(instance({ lambda: '/lambdas/a.js' }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0]).toMatchObject({ handlerKey: 'handler', communication: { type: 'ipc' } });
  });

  it('passes the communication, the limit and the acquire timeout on', () => {
    lambdaMiddleware(instance({ lambda: '/lambdas/a.js', communication: 'file', limit: 3, acquireTimeout: 500 }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0]).toMatchObject({ communication: { type: 'file' }, limit: 3, acquireTimeout: 500 });
  });

  it('passes the timeouts, the limit of the body and the environment on', () => {
    lambdaMiddleware(
      instance({ lambda: '/lambdas/a.js', startTimeout: 2000, timeout: 30000, limitRequestBody: 1024, restrictFileSystem: false, env: { TABLE: 'users' } })
    );

    expect(jest.mocked(httpMiddleware).mock.calls[0][0]).toMatchObject({
      startTimeout: 2000,
      timeout: 30000,
      limitRequestBody: 1024,
      restrictFileSystem: false,
      env: { TABLE: 'users' },
    });
  });

  it('leaves the limit to the default of the library when there is none', () => {
    lambdaMiddleware(instance({ lambda: '/lambdas/a.js' }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0].limit).toBeUndefined();
  });

  it('writes the path of the lambda with slashes, as the lambda worker is started with it', () => {
    lambdaMiddleware(instance({ lambda: 'C:\\lambdas\\a.js' }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0].lambdaPath).toBe('C:/lambdas/a.js');
  });

  describe('with routes', () => {
    // the files have to exist when the routes are made, so the folder is there before the tests
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-routes-'));
    const [orders, items, rest] = ['orders.js', 'items.js', 'rest.js'].map((file) => {
      fs.writeFileSync(path.join(folder, file), '');
      return path.join(folder, file);
    });

    afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

    /** one middleware per call, which the tests find again by the lambda and handler it was made for */
    const created: Array<{ options: Parameters<typeof httpMiddleware>[0]; middleware: ReturnType<typeof httpMiddleware> }> = [];
    const requestFor = (url: string) => Object.assign(new IncomingMessage(new Socket()), { url });
    const responseFor = () => {
      const response = new ServerResponse(requestFor('/'));
      Object.assign(response, { writeHead: jest.fn(), end: jest.fn() });
      return response;
    };
    const middlewareOf = (lambdaPath: string, handlerKey: string) => {
      const found = created.find(({ options }) => options.lambdaPath === lambdaPath && options.handlerKey === handlerKey);
      if (!found) throw new Error(`no middleware for ${lambdaPath}#${handlerKey}`);
      return found.middleware;
    };

    beforeEach(() => {
      created.length = 0;
      jest.mocked(httpMiddleware).mockImplementation((options) => {
        const middleware = Object.assign(jest.fn(), { handle: jest.fn(), close: jest.fn() });
        created.push({ options, middleware });
        return middleware;
      });
    });

    it('sends a request to the lambda and handler of the route that matches, with the captures as path parameters', () => {
      const handler = lambdaMiddleware(
        instance({
          routes: [
            { path: '/orders', lambda: orders, handler: 'list' },
            { pattern: '/orders/(?<id>[0-9]+)', lambda: orders, handler: 'get' },
          ],
        })
      );
      const list = requestFor('/orders?x=1');
      const get = requestFor('/orders/42');
      const response = responseFor();

      handler(list, response, jest.fn());
      handler(get, response, jest.fn());

      expect(middlewareOf(orders, 'list').handle).toHaveBeenCalledWith(list, response, undefined);
      expect(middlewareOf(orders, 'get').handle).toHaveBeenCalledWith(get, response, { id: '42' });
      expect(middlewareOf(orders, 'list').handle).toHaveBeenCalledTimes(1);
    });

    it('takes the first route that matches', () => {
      const handler = lambdaMiddleware(
        instance({
          routes: [
            { pattern: '/items/.*', lambda: items },
            { path: '/items/1', lambda: orders },
          ],
        })
      );

      handler(requestFor('/items/1'), responseFor(), jest.fn());

      expect(middlewareOf(items, 'handler').handle).toHaveBeenCalledTimes(1);
      expect(middlewareOf(orders, 'handler').handle).not.toHaveBeenCalled();
    });

    it('gives every route a middleware, and with it a limit, of its own, the limit of the server unless the route has one', () => {
      lambdaMiddleware(
        instance({
          limit: 4,
          acquireTimeout: 500,
          routes: [
            { path: '/orders', lambda: orders },
            { path: '/items', lambda: items, limit: 1 },
          ],
        })
      );

      expect(created.map(({ options }) => [options.lambdaPath, options.limit, options.acquireTimeout])).toEqual([
        [orders, 4, 500],
        [items, 1, 500],
      ]);
    });

    it('answers 404 without invoking a lambda when no route matches', () => {
      const handler = lambdaMiddleware(instance({ routes: [{ path: '/orders', lambda: orders }] }));
      const response = responseFor();

      handler(requestFor('/missing'), response, jest.fn());

      expect(response.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(response.end).toHaveBeenCalledWith(JSON.stringify({ message: 'Not Found' }));
      expect(created.every(({ middleware }) => jest.mocked(middleware.handle).mock.calls.length === 0)).toBe(true);
    });

    it('sends the paths that no route matches to `lambda`, which stays what it was', () => {
      const handler = lambdaMiddleware(instance({ lambda: rest, handler: 'main', routes: [{ path: '/orders', lambda: orders }] }));
      const request = requestFor('/anything');

      handler(request, responseFor(), jest.fn());

      expect(middlewareOf(rest, 'main').handle).toHaveBeenCalledWith(request, expect.anything());
    });

    it('stops the lambdas of every route when it is closed', () => {
      const handler = lambdaMiddleware(instance({ lambda: rest, routes: [{ path: '/orders', lambda: orders }] }));

      handler.close();

      expect(created.map(({ middleware }) => middleware.close)).toHaveLength(2);
      created.forEach(({ middleware }) => expect(middleware.close).toHaveBeenCalledTimes(1));
    });

    it.each([
      ['without a lambda', { path: '/orders', lambda: '' }, /has no lambda/],
      ['whose lambda is not a file', { path: '/orders', lambda: path.join(os.tmpdir(), 'missing-lambda.js') }, /is not a file/],
      ['with an invalid pattern', { pattern: '/orders/(', lambda: orders }, /is not valid/],
    ])('refuses a route %s, and leaves no lambdas behind', (_, route, message) => {
      expect(() => lambdaMiddleware(instance({ routes: [{ path: '/first', lambda: items }, route] }))).toThrow(message);

      created.forEach(({ middleware }) => expect(middleware.close).toHaveBeenCalledTimes(1));
    });
  });
});
