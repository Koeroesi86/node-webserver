import type { NextFunction, Request, Response } from 'express';
import { isHandedOff } from '@koeroesi86/node-worker-express';
import getDate from '../utils/getDate';
import logger from '../utils/logger';
import type { LogLevels } from '../types';

const fullUrl = (request: Request) => `${request.protocol}://${request.get('host')}${request.originalUrl}`;

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
    if (logsRequests) {
      // after the request was handed on, with the cheapest way to wait for that
      setImmediate(() => {
        const timePrefix = `[${getDate()}]`;
        logger.success(
          [
            timePrefix,
            `[${alias}]`,
            'REQUEST',
            (request.method || '!no-method!').toUpperCase(),
            fullUrl(request),
            'HEADERS',
            `${serialiseHeaders(request)}`,
          ].join(' ')
        );
      });
    }

    if (logsResponses) {
      // a response whose connection went to a worker closes here without finishing, the worker writes the body
      const logResponse = () => {
        const level = getResponseLevel(response.statusCode);
        if (!logger.isEnabled(level)) return;

        const timePrefix = `[${getDate()}]`;
        const logLine = [
          timePrefix,
          `[${alias}]`,
          'RESPONSE',
          (request.method || '!no-method!').toUpperCase(),
          fullUrl(request),
          response.statusCode,
          response.statusMessage,
          `${response.get('Content-Length') || 0}b sent`,
        ].join(' ');
        logger[level](logLine);
      };
      response.on('finish', logResponse);
      response.on('close', () => isHandedOff(response) && logResponse());
    }
    next();
  };
};

export default accessLogsMiddleware;
