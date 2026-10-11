import type { Response } from 'express';
import type { OutgoingHttpHeaders } from 'http';

/** answers with a short plain text, for the cases the middleware answers by itself */
const writeTextResponse = (response: Response, statusCode: number, message: string, headers: OutgoingHttpHeaders = {}) => {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain', ...headers });
  response.end(message);
};

export default writeTextResponse;
