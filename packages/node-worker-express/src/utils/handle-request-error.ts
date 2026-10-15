import type { Response } from 'express';
import WorkerAbandonedError from './workerAbandonedError';
import WorkerUnavailableError from './workerUnavailableError';
import writeTextResponse from './write-text-response';

/** Answers what failed before the request reached a worker: an abandoned request needs no answer, a busy pool is a 503, anything else is for express. */
const handleRequestError = (error: unknown, response: Response, next: (error: unknown) => void) => {
  if (error instanceof WorkerAbandonedError) return;
  if (!(error instanceof WorkerUnavailableError) || response.headersSent) return next(error);

  // the details name a file of the server, the client only needs to know when to come back
  writeTextResponse(response, 503, 'Service unavailable.', { 'Retry-After': Math.max(1, Math.ceil(error.retryAfterMs / 1000)) });
};

export default handleRequestError;
