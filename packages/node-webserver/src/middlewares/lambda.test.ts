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

  it('passes the timeouts and the environment on', () => {
    lambdaMiddleware(instance({ lambda: '/lambdas/a.js', startTimeout: 2000, timeout: 30000, env: { TABLE: 'users' } }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0]).toMatchObject({ startTimeout: 2000, timeout: 30000, env: { TABLE: 'users' } });
  });

  it('leaves the limit to the default of the library when there is none', () => {
    lambdaMiddleware(instance({ lambda: '/lambdas/a.js' }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0].limit).toBeUndefined();
  });

  it('writes the path of the lambda with slashes, as the lambda worker is started with it', () => {
    lambdaMiddleware(instance({ lambda: 'C:\\lambdas\\a.js' }));

    expect(jest.mocked(httpMiddleware).mock.calls[0][0].lambdaPath).toBe('C:/lambdas/a.js');
  });
});
