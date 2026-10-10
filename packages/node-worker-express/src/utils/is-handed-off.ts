import type { ServerResponse } from 'http';

/** the responses whose body the worker writes to the client itself, they close without finishing in this process */
export const handedOffResponses = new WeakSet<ServerResponse>();

/** whether the connection of the response was handed to a worker, which then writes the body: the response closes when the connection is handed over, it does not finish */
export default function isHandedOff(response: ServerResponse) {
  return handedOffResponses.has(response);
}
