import type { createBodyForwarder, RequestEvent } from '@koeroesi86/node-worker/pool';
import { Protocols } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';

interface RequestListenersParams {
  request: Request;
  response: Response;
  event: RequestEvent;
  streamsBody: boolean;
  bodyForwarder: Pick<ReturnType<typeof createBodyForwarder>, 'part' | 'end'>;
  /** the request is over for the connection and the worker */
  cleanup: () => void;
  /** takes what undoes a registration, to be run at the cleanup of the request */
  addUndo: (undo: () => void) => void;
}

/** Ends the request when the client goes away or the response is done, and drops the rest of a streamed body then. */
const registerRequestListeners = ({ request, response, event, streamsBody, bodyForwarder, cleanup, addUndo }: RequestListenersParams) => {
  request.on('aborted', cleanup);
  addUndo(() => request.off('aborted', cleanup));

  if (streamsBody) {
    addUndo(() => {
      // what is still to come of the body is read and dropped, a request that is not read keeps its connection stuck
      request.off('data', bodyForwarder.part);
      request.off('end', bodyForwarder.end);
      request.resume();
    });
  }

  if (event.protocol !== Protocols.http) return;

  // the close of the response, as the request closes as soon as its body was read, which says nothing about the client being gone
  response.on('close', cleanup);
  response.on('finish', cleanup);
  addUndo(() => response.off('close', cleanup));
};

export default registerRequestListeners;
