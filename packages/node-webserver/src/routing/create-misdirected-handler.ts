import { readFileSync } from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';
import { PAGE_TYPES } from '../constants';

/** answers a request for a host that no server takes with `421`, with the file given (read once, here) or a plain text */
const createMisdirectedHandler = (page?: string): RequestHandler => {
  const body = page ? readFileSync(page) : 'Misdirected Request';
  const type = (page && PAGE_TYPES[path.extname(page).toLowerCase()]) || 'text/plain; charset=utf-8';

  return (request, response) => {
    response.status(421).type(type).send(body);
  };
};

export default createMisdirectedHandler;
