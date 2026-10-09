import net from 'net';
import { TLSSocket } from 'tls';
import type { Request, Response } from 'express';
import { WORKER_EVENT } from '../constants';
import type { ResponseMessage } from '../types';
import getHeader from './get-header';
import { handedOffResponses } from './is-handed-off';
import type { WorkerLease } from './workerPool';

/** the statuses whose response has no body, which leaves nothing to hand over */
const bodylessStatuses = [204, 205, 304];

interface ResponseHandOffParams {
  request: Request;
  response: Response;
  lease: WorkerLease;
  requestId: string;
  /** the parts of a request body are still coming in over the connection */
  streamsBody: boolean;
  /** the smallest response in bytes that is handed over, 0 or nothing for none */
  minimumLength: number | undefined;
  /** how long the client may take nothing before the worker closes the connection, in milliseconds */
  timeout: number | undefined;
  /** the connection is the worker's now, the response timeout of the server does not apply any more */
  onHandedOver: () => void;
  /** the connection could not be given to the worker */
  onFailed: () => void;
}

/**
 * Gives the connection of the client to the worker, which then writes the body to it, so that the bytes of a big response do not pass through the server.
 * The worker asks with the head of the response, a refusal makes it stream the body through the server as usual.
 */
const createResponseHandOff = ({ request, response, lease, requestId, streamsBody, minimumLength, timeout, onHandedOver, onFailed }: ResponseHandOffParams) => {
  let active = false;

  /** whether the body may go to the client from the worker: big enough to be worth a connection, on a plain HTTP/1 one that has nothing else to read or write */
  const isAllowed = ({ statusCode, headers }: ResponseMessage) =>
    [
      !!minimumLength && Number(getHeader(headers, 'content-length')) >= minimumLength,
      getHeader(headers, 'transfer-encoding') === undefined,
      statusCode >= 200 && !bodylessStatuses.includes(statusCode),
      request.method !== 'HEAD',
      request.httpVersionMajor === 1,
      !streamsBody,
      !response.headersSent,
      // the state of TLS lives in this process, such a socket cannot be moved
      request.socket instanceof net.Socket && !(request.socket instanceof TLSSocket) && !request.socket.destroyed,
    ].every(Boolean);

  const refuse = () => lease.send({ type: WORKER_EVENT.RESPONSE_HANDOFF_REFUSE, requestId });

  const start = async (head: ResponseMessage) => {
    if (!isAllowed(head)) return refuse();

    const { socket } = request;
    const encoding = getHeader(head.headers, 'content-encoding');
    // set one by one, so that what a middleware in front changes in them can be read back
    Object.entries(head.headers ?? {}).forEach(([name, value]) => response.setHeader(name, value));
    // the connection does not come back from the worker, the client is told that it ends with this response
    response.setHeader('Connection', 'close');
    response.writeHead(head.statusCode);
    // a middleware that encodes the body, as the compression does, has to see it: it is streamed through this process then, the head is out already
    if (response.getHeader('content-encoding') !== encoding || !response.hasHeader('content-length')) return refuse();

    response.flushHeaders();
    // the head has to be written before the socket leaves this process
    await new Promise((resolve) => socket.write(Buffer.alloc(0), resolve));
    // the client is gone, the cleanup has told the worker already
    if (socket.destroyed) return undefined;

    active = true;
    handedOffResponses.add(response);
    onHandedOver();
    try {
      await lease.handOff({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId, timeout: timeout ?? 0 }, socket);
    } catch {
      reset();
      onFailed();
      return undefined;
    }
    // the handle is in the worker now, this lets the server and the response here let go of the connection, the worker frees itself when it is done
    return socket.destroy();
  };

  function reset() {
    active = false;
    handedOffResponses.delete(response);
  }

  /** the worker is done with the connection, the response stays marked as handed over for what looks at it after it */
  const finish = () => {
    active = false;
  };

  return {
    /** the worker writes the body to the client, the connection is not this process' to watch until the worker says it is done */
    isActive: () => active,
    start,
    finish,
    reset,
  };
};

export default createResponseHandOff;
