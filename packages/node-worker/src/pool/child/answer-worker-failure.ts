import { InternalServerError } from '../constants';
import type { ResponseEvent } from '../types';

/** a failing worker answers the request instead of leaving it waiting, unless it already did */
const answerWorkerFailure = (respond: (event: ResponseEvent) => unknown, hasResponded: () => boolean) => (error: unknown) => {
  console.error(error);
  if (!hasResponded()) respond(InternalServerError);
};

export default answerWorkerFailure;
