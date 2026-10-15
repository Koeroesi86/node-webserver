import type RequestEvent from '../classes/RequestEvent';
import type ResponseEvent from '../classes/ResponseEvent';

let requests: Record<string, RequestEvent> = {};
let responses: Record<string, ResponseEvent> = {};

const getRequestKey = (id: string) => `request-${id}`;
const getResponseKey = (id: string) => `response-${id}`;

/** what the process keeps for the requests in flight: the invoker and executor storages of one process share it */
export const ipcStore = {
  reset: () => {
    requests = {};
    responses = {};
  },
  keepRequest: (id: string, request: RequestEvent) => {
    requests[getRequestKey(id)] = request;
  },
  findRequest: (id: string): RequestEvent | undefined => requests[getRequestKey(id)],
  keepResponse: (id: string, response: ResponseEvent) => {
    responses[getResponseKey(id)] = response;
  },
  findResponse: (id: string): ResponseEvent | undefined => responses[getResponseKey(id)],
  forget: (id: string) => {
    delete requests[getRequestKey(id)];
    delete responses[getResponseKey(id)];
  },
};
