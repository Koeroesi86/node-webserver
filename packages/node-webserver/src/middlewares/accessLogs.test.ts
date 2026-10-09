import { EventEmitter } from 'events';
import accessLogsMiddleware from './accessLogs';
import { isHandedOff } from '@koeroesi86/node-worker-express';
import logger from '../utils/logger';
import type { NextFunction, Request, Response } from 'express';

jest.mock('../utils/logger', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), isEnabled: jest.fn() } }));
jest.mock('@koeroesi86/node-worker-express', () => ({ isHandedOff: jest.fn(() => false) }));
jest.mock('../utils/getDate', () => ({ __esModule: true, default: () => '2026-01-01 00:00:00' }));

const mockedLogger = jest.mocked(logger);

const enable = (...levels: string[]) => mockedLogger.isEnabled.mockImplementation((level) => levels.includes(level));

const createRequest = () =>
  ({
    method: 'get',
    protocol: 'http',
    originalUrl: '/page?x=1',
    headers: { host: 'web.localhost', accept: '*/*', 'user-agent': 'test' },
    get: (name: string) => (name === 'host' ? 'web.localhost' : undefined),
  } as unknown as Request);

const createResponse = (statusCode: number, statusMessage = 'OK') =>
  Object.assign(new EventEmitter(), {
    statusCode,
    statusMessage,
    get: (name: string) => (name === 'Content-Length' ? '12' : undefined),
  }) as unknown as Response;

describe('accessLogsMiddleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const run = (statusCode: number, statusMessage?: string) => {
    const response = createResponse(statusCode, statusMessage);
    const next = jest.fn();
    accessLogsMiddleware({ alias: 'http' })(createRequest(), response, next as NextFunction);
    jest.runAllTimers();
    response.emit('finish');

    return { response, next };
  };

  describe('with all levels on', () => {
    beforeEach(() => enable('success', 'error'));

    it('logs the request with its headers in alphabetical order', () => {
      run(200);

      expect(mockedLogger.success).toHaveBeenCalledWith(
        '[2026-01-01 00:00:00] [http] REQUEST GET http://web.localhost/page?x=1 HEADERS {"accept":"*/*","host":"web.localhost","user-agent":"test"}'
      );
    });

    it('logs a response below 400 as a success, with its size', () => {
      run(200);

      expect(mockedLogger.success).toHaveBeenLastCalledWith('[2026-01-01 00:00:00] [http] RESPONSE GET http://web.localhost/page?x=1 200 OK 12b sent');
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it('logs a response from 400 as an error', () => {
      run(404, 'Not Found');

      expect(mockedLogger.error).toHaveBeenCalledWith('[2026-01-01 00:00:00] [http] RESPONSE GET http://web.localhost/page?x=1 404 Not Found 12b sent');
    });

    it('goes on to the next middleware', () => {
      expect(run(200).next).toHaveBeenCalledTimes(1);
    });
  });

  describe('with the levels off', () => {
    /** a request that fails on anything the middleware reads from it, to see that nothing is built */
    const untouchable = () =>
      new Proxy(
        {},
        {
          get: (_, property) => {
            throw new Error(`The middleware read ${String(property)}.`);
          },
        }
      ) as Request;

    it('does nothing for a request, not even setting a timer or listening for the response', () => {
      enable();
      const response = createResponse(200);
      const next = jest.fn();

      accessLogsMiddleware({})(untouchable(), response, next as NextFunction);
      jest.runAllTimers();
      response.emit('finish');

      expect(next).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(response.listenerCount('finish')).toBe(0);
      expect(mockedLogger.success).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it('logs nothing that is off when only the errors are on, and does not build the line of a success', () => {
      enable('error');
      const response = createResponse(200);
      const request = createRequest();
      const get = jest.spyOn(request, 'get');

      accessLogsMiddleware({})(request, response, jest.fn() as NextFunction);
      jest.runAllTimers();
      response.emit('finish');

      expect(get).not.toHaveBeenCalled();
      expect(mockedLogger.success).not.toHaveBeenCalled();
    });

    it('logs a response whose connection went to a worker when it closes, as it does not finish here', () => {
      enable('success', 'error');
      const response = createResponse(200);
      jest.mocked(isHandedOff).mockReturnValueOnce(true);

      accessLogsMiddleware({})(createRequest(), response, jest.fn() as NextFunction);
      jest.runAllTimers();
      response.emit('close');

      expect(mockedLogger.success).toHaveBeenCalledWith(expect.stringContaining('RESPONSE GET http://web.localhost/page?x=1 200 OK 12b sent'));
    });

    it('does not log a response that closes without finishing and was not handed over', () => {
      enable('success', 'error');
      const response = createResponse(200);

      accessLogsMiddleware({})(createRequest(), response, jest.fn() as NextFunction);
      jest.runAllTimers();
      response.emit('close');

      expect(mockedLogger.success).not.toHaveBeenCalledWith(expect.stringContaining('RESPONSE'));
    });

    it('logs the error responses when only the errors are on', () => {
      enable('error');
      const response = createResponse(500, 'Internal Server Error');

      accessLogsMiddleware({})(createRequest(), response, jest.fn() as NextFunction);
      jest.runAllTimers();
      response.emit('finish');

      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
      expect(mockedLogger.success).not.toHaveBeenCalled();
    });

    it('does not build the line of an error when only the successes are on', () => {
      enable('success');
      const response = createResponse(404, 'Not Found');
      const request = createRequest();

      accessLogsMiddleware({})(request, response, jest.fn() as NextFunction);
      jest.runAllTimers();
      const get = jest.spyOn(request, 'get');
      response.emit('finish');

      expect(get).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });
  });
});
