import { readFileSync } from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';
import asString from './as-string';
import lowerCaseHeaders from './lower-case-headers';
import { PAGE_TYPES } from '../constants';
import type { HeaderMap } from '../types';

/** what describes the body that was not sent, so it goes with it */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-range', 'transfer-encoding', 'etag', 'last-modified'];

const isHtml = (headers: HeaderMap) => asString(headers['content-type']).trim().toLowerCase().startsWith('text/html');

/**
 * Answers the statuses of `errorPages` with the file of the status instead of the body that was about to be sent, the files are read once, here. A
 * response that is html already is a page someone made for it, and is left as it is.
 */
const createErrorPagesHandler = (errorPages: Record<string, string>): RequestHandler => {
  const pages = new Map(
    Object.entries(errorPages).map(([status, file]) => [
      Number(status),
      { body: readFileSync(file), type: PAGE_TYPES[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8' },
    ])
  );

  return (request, response, next) => {
    const { writeHead, write, end } = response;
    let decided = false;
    let page: ReturnType<typeof pages.get>;

    /** for the first write or end without writeHead: node writes the head of the status that was set */
    const decideHead = () => {
      if (!decided) response.writeHead(response.statusCode);
    };

    Object.assign(response, {
      writeHead: (statusCode: number, ...rest: unknown[]) => {
        decided = true;
        const given = rest.find((argument): argument is HeaderMap => typeof argument === 'object' && argument !== null && !Array.isArray(argument));
        const found = pages.get(statusCode);
        // a list of header names and values is rare and cannot be told apart in place
        if (!found || rest.some(Array.isArray) || isHtml({ ...lowerCaseHeaders(response.getHeaders()), ...lowerCaseHeaders(given ?? {}) })) {
          return Reflect.apply(writeHead, response, [statusCode, ...rest]);
        }

        page = found;
        BODY_HEADERS.forEach((name) => response.removeHeader(name));
        Object.entries(given ?? {})
          .filter(([name]) => !BODY_HEADERS.includes(name.toLowerCase()))
          .forEach(([name, value]) => response.setHeader(name, Array.isArray(value) ? value.map(String) : String(value)));
        response.setHeader('Content-Type', found.type);
        response.setHeader('Content-Length', found.body.length);

        return Reflect.apply(writeHead, response, [statusCode]);
      },
      write: (...args: unknown[]) => {
        decideHead();

        return page ? true : Reflect.apply(write, response, args);
      },
      end: (...args: unknown[]) => {
        decideHead();

        return Reflect.apply(end, response, page ? [page.body, ...args.filter((argument) => typeof argument === 'function')] : args);
      },
    });
    next();
  };
};

export default createErrorPagesHandler;
