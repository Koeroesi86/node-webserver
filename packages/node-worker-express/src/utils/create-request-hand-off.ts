import net from 'net';
import { TLSSocket } from 'tls';
import type { Request, Response } from 'express';
import { WORKER_EVENT } from '../constants';
import type { RequestEvent, ResponseMessage } from '../types';
import getReadStop from './get-read-stop';
import { handedOffRequests, handedOffResponses, requestHandOffDoneEvent } from './is-handed-off';
import type { WorkerLease } from './workerPool';

interface RequestHandOffParams {
  request: Request;
  response: Response;
  lease: WorkerLease;
  requestId: string;
  event: RequestEvent;
  /** the parts of the body are to be streamed, it did not arrive with the request */
  streamsBody: boolean;
  /** the smallest body in bytes that is handed over, 0 or nothing for none */
  minimumLength: number | undefined;
  /** the largest body in bytes the server accepts, 0 or nothing for no limit: a body that is announced bigger stays here, to be answered with 413 */
  limit: number | undefined;
  /** how long the client may take nothing before the worker closes the connection, in milliseconds */
  timeout: number | undefined;
  /** the connection is the worker's now, the response timeout of the server does not apply any more */
  onHandedOver: () => void;
  /** the connection could not be given to the worker */
  onFailed: () => void;
}

/**
 * Gives the connection of the client to the worker once the head of a request with a big body was read, so the bytes of the body do not pass through the server.
 * What the parser had read of the body goes along, the worker reads the rest from the connection and writes the response to it.
 */
const createRequestHandOff = ({
  request,
  response,
  lease,
  requestId,
  event,
  streamsBody,
  minimumLength,
  limit,
  timeout,
  onHandedOver,
  onFailed,
}: RequestHandOffParams) => {
  let active = false;
  const length = Number(request.headers['content-length']);

  /** whether the request qualifies: a body of a known and big enough length on a plain HTTP/1 connection that nothing else reads */
  const isAllowed = () =>
    [
      !!minimumLength && Number.isInteger(length) && length >= minimumLength,
      !limit || length <= limit,
      streamsBody,
      request.headers['transfer-encoding'] === undefined,
      request.httpVersionMajor === 1,
      // a middleware in front that reads the body keeps it
      request.listenerCount('data') === 0,
      // the state of TLS lives in this process, such a socket cannot be moved
      request.socket instanceof net.Socket && !(request.socket instanceof TLSSocket) && !request.socket.destroyed,
      // without it a byte of the body could be read here and lost after the connection left
      getReadStop(request.socket) !== undefined,
    ].every(Boolean);

  function reset() {
    active = false;
    handedOffRequests.delete(response);
    handedOffResponses.delete(response);
  }

  const start = async () => {
    const { socket } = request;
    const stopReading = getReadStop(socket);
    // All of this happens before anything else can run, so the order of the bytes holds: what the parser has read of the body and handed to the request, then what the socket has
    // read after it. The rest of the body stays in the kernel for the worker, as the socket is not read any more once it was drained.
    const parsed = request.read();
    socket.pause();
    const buffered = socket.read();
    stopReading?.();
    // what follows the body on the connection is not part of this request
    const prefix = Buffer.concat([parsed ?? Buffer.alloc(0), buffered ?? Buffer.alloc(0)]).subarray(0, length);

    active = true;
    handedOffRequests.add(response);
    handedOffResponses.add(response);
    onHandedOver();
    try {
      await lease.handOff({ type: WORKER_EVENT.REQUEST_HANDOFF, requestId, event, prefix: prefix.toString('base64'), length, timeout: timeout ?? 0 }, socket);
    } catch {
      reset();
      onFailed();
      return;
    }
    // the handle is in the worker now, this lets the server and the response here let go of the connection, the worker frees itself when it is done
    socket.destroy();
  };

  /** the worker is done with the connection, what it answered is set on the response for what looks at it after */
  const finish = ({ statusCode, headers }: ResponseMessage) => {
    active = false;
    response.statusCode = statusCode;
    Object.entries(headers ?? {}).forEach(([name, value]) => response.setHeader(name, value));
    response.emit(requestHandOffDoneEvent);
  };

  return {
    /** the worker reads the body and writes the response, the connection is not this process' to watch until the worker says it is done */
    isActive: () => active,
    isAllowed,
    start,
    finish,
    reset,
  };
};

export default createRequestHandOff;
