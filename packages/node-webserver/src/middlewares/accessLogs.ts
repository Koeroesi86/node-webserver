import type { NextFunction, Request, Response } from 'express';
import getDate from '../utils/getDate';
import logger from '../utils/logger';

const fullUrl = (request: Request) => `${request.protocol}://${request.get('host')}${request.originalUrl}`;

const serialiseHeaders = (request: Request) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(request.headers)
        .sort()
        .map((key) => [key, request.headers[key]])
    )
  );

const getResponseLogger = (statusCode: number) => {
  if (statusCode < 400) return logger.success;
  if (statusCode >= 400) return logger.error;
  return logger.info;
};

const accessLogsMiddleware =
  ({ alias = 'APP' }: { alias?: string }) =>
  (request: Request, response: Response, next: NextFunction) => {
    setTimeout(() => {
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
    }, 0);
    response.on('finish', () => {
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
      getResponseLogger(response.statusCode)(logLine);
    });
    next();
  };

export default accessLogsMiddleware;
