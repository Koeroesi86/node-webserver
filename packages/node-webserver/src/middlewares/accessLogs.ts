import type { NextFunction, Request, Response } from 'express';
import getDate from '../utils/getDate';
import logger from '../utils/logger';
import type { LogLevels } from '../types';

// the host header is read from the parsed headers, request.get() lowercases the name and looks at the special cases of express for every call
const fullUrl = (request: Request) => `${request.protocol}://${request.headers.host}${request.originalUrl}`;

const serialiseHeaders = (request: Request) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(request.headers)
        .sort()
        .map((key) => [key, request.headers[key]])
    )
  );

const getResponseLevel = (statusCode: number): keyof LogLevels => (statusCode < 400 ? 'success' : 'error');

const accessLogsMiddleware = ({ alias = 'APP' }: { alias?: string }) => {
  // the levels do not change while the server runs, and a line that is not logged must not be built: that takes a sorted copy of the headers and a string
  const logsRequests = logger.isEnabled('success');
  const logsResponses = logger.isEnabled('success') || logger.isEnabled('error');

  return (request: Request, response: Response, next: NextFunction) => {
    // both lines of a request show the same url, and request.protocol of express is not cheap, so it is built when the first line needs it
    let url: string | undefined;
    const getUrl = () => (url ??= fullUrl(request));

    if (logsRequests) {
      // after the request was handed on, with the cheapest way to wait for that
      setImmediate(() => {
        const timePrefix = `[${getDate()}]`;
        logger.success(
          [timePrefix, `[${alias}]`, 'REQUEST', (request.method || '!no-method!').toUpperCase(), getUrl(), 'HEADERS', `${serialiseHeaders(request)}`].join(' ')
        );
      });
    }

    if (logsResponses) {
      response.on('finish', () => {
        const level = getResponseLevel(response.statusCode);
        if (!logger.isEnabled(level)) return;

        const timePrefix = `[${getDate()}]`;
        const logLine = [
          timePrefix,
          `[${alias}]`,
          'RESPONSE',
          (request.method || '!no-method!').toUpperCase(),
          getUrl(),
          response.statusCode,
          response.statusMessage,
          `${response.get('Content-Length') || 0}b sent`,
        ].join(' ');
        logger[level](logLine);
      });
    }
    next();
  };
};

export default accessLogsMiddleware;
