import { WORKER_EVENT, type createBodyForwarder, type RequestEvent, type WorkerLease } from '@koeroesi86/node-worker/pool';
import type { Request } from 'express';
import type createRequestHandOff from './create-request-hand-off';

interface SendRequestParams {
  request: Request;
  lease: WorkerLease;
  requestId: string;
  event: RequestEvent;
  /** a body that had arrived with the request, it goes along with it */
  inlineBody: Buffer | undefined;
  /** the parts of the body follow the request */
  streamsBody: boolean;
  requestHandOff: Pick<ReturnType<typeof createRequestHandOff>, 'isAllowed' | 'start'>;
  bodyForwarder: Pick<ReturnType<typeof createBodyForwarder>, 'part' | 'end'>;
}

/** Gives the request to the worker: the connection itself when the body is big enough, else the request as a message and the parts of its body after it. */
const sendRequest = ({ request, lease, requestId, event, inlineBody, streamsBody, requestHandOff, bodyForwarder }: SendRequestParams) => {
  if (requestHandOff.isAllowed()) {
    void requestHandOff.start();
    return;
  }

  lease.send({
    type: WORKER_EVENT.REQUEST,
    requestId,
    // a body that goes along travels as the bytes of the frame, which spares encoding it as base64 and decoding it in the worker
    event: inlineBody === undefined ? event : { ...event, body: inlineBody },
  });

  if (streamsBody) {
    request.on('data', bodyForwarder.part);
    request.once('end', bodyForwarder.end);
  }
};

export default sendRequest;
