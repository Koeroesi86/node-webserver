import type { IncomingMessage } from 'http';
import { RequestBodyWindow, WORKER_EVENT } from '../constants';
import type { WorkerLease } from './workerPool';

export interface BodyForwarderParams {
  request: IncomingMessage;
  lease: WorkerLease;
  requestId: string;
  /** the largest body in bytes, 0 or none for no limit */
  limit: number | undefined;
  /** the body is too big, the request is over */
  onTooBig: () => void;
  onProgress: () => void;
}

/** Sends the parts of a request body to the worker, no more than a few ahead of what the worker has taken. */
const createBodyForwarder = ({ request, lease, requestId, limit, onTooBig, onProgress }: BodyForwarderParams) => {
  /** how many parts of the streamed request body the worker has not taken yet */
  let unacknowledged = 0;
  let receivedBytes = 0;

  return {
    part: (chunk: Buffer) => {
      receivedBytes += chunk.length;

      if (limit && receivedBytes > limit) {
        onTooBig();
        return;
      }

      lease.send({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: chunk } });
      unacknowledged += 1;
      onProgress();
      // the worker takes the parts at its pace, so a slow worker slows the upload down instead of filling the memory
      if (unacknowledged >= RequestBodyWindow) request.pause();
    },
    end: () => lease.send({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: null } }),
    acknowledge: () => {
      unacknowledged -= 1;
      if (unacknowledged < RequestBodyWindow) request.resume();
    },
  };
};

export default createBodyForwarder;
