import type { ServerResponse } from 'http';

/** the responses whose body the worker writes to the client itself, they close without finishing in this process */
export const handedOffResponses = new WeakSet<ServerResponse>();

/** the responses of requests whose connection went to the worker with the request, the worker reads the body and writes the whole response */
export const handedOffRequests = new WeakSet<ServerResponse>();

/** the event of a response of a handed over request, once the worker is done with the connection: its status and size are set on the response then, for what logs it */
export const requestHandOffDoneEvent = 'request-hand-off-done';

/** whether the connection of the response was handed to a worker, which then writes the body: the response closes when the connection is handed over, it does not finish */
export default function isHandedOff(response: ServerResponse) {
  return handedOffResponses.has(response);
}

/** whether the worker also read the body of the request and wrote the head of the response, which the response here knows nothing about until the worker is done */
export function isRequestHandedOff(response: ServerResponse) {
  return handedOffRequests.has(response);
}
