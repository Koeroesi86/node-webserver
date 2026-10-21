import net from 'net';
import type { Duplex } from 'stream';
import { NoRequest, Protocols, WORKER_EVENT } from '../constants';
import type {
  HandOffEvent,
  InvokableWorker,
  RequestEvent,
  RequestHandOffMessage,
  ResponseEvent,
  WorkerInputEvent,
  WorkerOutputEvent,
  WSFrameEvent,
} from '../types';
import answerWorkerFailure from './answer-worker-failure';
import closeWsConnection from './close-ws-connection';
import createBodyStream from './create-body-stream';
import createEmptyBody from './create-empty-body';
import createHandedRequest from './create-handed-request';
import createHandOffRequests from './create-hand-off-requests';
import createMetricsWaiting from './create-metrics-waiting';
import createRequestContexts from './create-request-contexts';
import type { Stream } from './create-request-contexts';
import createResponseSender from './create-response-sender';
import createWorkerEvent from './create-worker-event';
import createChannel from './create-channel';
import invokeWorker from './invoke-worker';
import isRequestHandOff from './is-request-hand-off';
import receiveWsMessage from './receive-ws-message';
import sendWsMessage from './send-ws-message';
import toResponseMessage from './to-response-message';
import type { WorkerEnvironment } from './worker-environment';

type MessageOf<Type extends WORKER_EVENT> = Extract<WorkerInputEvent, { type: Type }>;

/**
 * The side of a worker process of the protocol with the server: requests come in over the socket pair, and the worker is called for each,
 * with the state of every request in its own context. `socket` is the stream under the channel, `receiveHandOff` takes what the IPC channel of node carries.
 */
export default function createWorkerSession(worker: InvokableWorker, socket: Duplex) {
  const contexts = createRequestContexts();
  // the messages only arrive after the session is built
  const channel = createChannel<WorkerInputEvent, WorkerOutputEvent>(socket, (message) => messageListener(message));
  const metrics = createMetricsWaiting(contexts, channel);
  const handOffs = createHandOffRequests((requestId, { statusCode, headers }) =>
    channel.send({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId, event: { statusCode, headers } })
  );
  const env: WorkerEnvironment = { worker, channel, isWritable: () => socket.writable, contexts, metrics, handOffs };
  const { sendResponse, sendResponsePart } = createResponseSender(env);

  /** what the worker answers a request with: the response, a part of it, or a message to a websocket client */
  const createResponseCallback =
    (requestId: string, stream: Stream, onResponded: () => void) => (responseEvent: ResponseEvent | HandOffEvent | WSFrameEvent) => {
      onResponded();

      if ('handOff' in responseEvent) return handOffs.request(requestId, stream.aborted, responseEvent);

      if ('sendWsMessage' in responseEvent) return sendWsMessage(env, requestId, stream, responseEvent);

      return 'emit' in responseEvent ? sendResponsePart(requestId, stream, responseEvent) : sendResponse(requestId, responseEvent);
    };

  /** the request is over for the worker: what it waits for will not come, and the rest of the request body is dropped */
  const abortRequest = (requestId: string) => {
    handOffs.settle(requestId);
    contexts.get(requestId)?.upload?.stream.destroy(new Error('The request was aborted.'));
    const stream = contexts.get(requestId)?.stream;
    if (!stream) return;

    stream.aborted = true;
    stream.waiting.splice(0).forEach((resolve) => resolve(false));
  };

  const startRequest = ({ requestId, event: { body, ...request } }: MessageOf<WORKER_EVENT.REQUEST>) => {
    // the body is given to the worker as its stream, not as a part of the request
    let responded = false;
    const stream: Stream = { waiting: [], aborted: false };
    const context = contexts.open(requestId);
    context.stream = stream;
    if (request.protocol === Protocols.websocket) context.webSocket = { event: request, stream };

    const callback = createResponseCallback(requestId, stream, () => {
      responded = true;
    });

    invokeWorker(
      worker,
      createWorkerEvent(request, requestId, createBodyStream(contexts, channel, requestId, request.hasBody, body), () => metrics.request(requestId), body),
      callback,
      answerWorkerFailure(callback, () => responded),
      // a worker that answered without streaming is done, one that still streams cleans up after its last part
      () => {
        metrics.clear(requestId);
        // a websocket connection is streamed to until it closes
        contexts.change(requestId, (current) => {
          if (!current.webSocket && stream.waiting.length === 0) current.stream = undefined;
        });
      }
    );
  };

  /** a request whose connection the server handed over: the worker reads the body from the connection and writes the response to it, the channel only tells the server when it is done */
  const startHandedRequest = (message: RequestHandOffMessage, handedSocket: net.Socket) => {
    const { requestId, event } = message;
    const handed = createHandedRequest({
      message,
      socket: handedSocket,
      onClosed: (summary) => {
        metrics.clear(requestId);
        channel.send({ type: WORKER_EVENT.REQUEST_HANDOFF_DONE, requestId, event: summary });
      },
    });

    invokeWorker(
      worker,
      createWorkerEvent({ ...event, hasBody: true }, requestId, handed.bodyStream, () => metrics.request(requestId)),
      handed.respond,
      answerWorkerFailure(handed.respond, handed.hasResponded)
    );
  };

  const closeConnection = (requestId: string, request: RequestEvent | undefined) => {
    closeWsConnection(contexts, requestId);
    invokeWorker(
      worker,
      createWorkerEvent({ ...(request ?? NoRequest), closed: true }, requestId, createEmptyBody(), () => metrics.request(requestId)),
      (responseEvent: ResponseEvent | HandOffEvent) => {
        // the connection is gone, there is nothing to hand over
        if ('handOff' in responseEvent) return;

        channel.send({
          type: WORKER_EVENT.WS_CONNECTION_CLOSE_ACKNOWLEDGE,
          requestId,
          event: toResponseMessage(responseEvent),
        });
      },
      console.error,
      // the connection is closed, nothing will ask the worker for metrics through it any more
      () => metrics.clear(requestId)
    );
  };

  function messageListener(message: WorkerInputEvent) {
    switch (message.type) {
      case WORKER_EVENT.RESPONSE_ACKNOWLEDGE:
        contexts.get(message.requestId)?.stream?.waiting.shift()?.(true);
        break;
      case WORKER_EVENT.REQUEST_BODY:
        contexts.get(message.requestId)?.upload?.receive(message.event);
        break;
      case WORKER_EVENT.METRICS:
        metrics.receive(message.requestId, message.event);
        break;
      case WORKER_EVENT.RESPONSE_HANDOFF_REFUSE:
        handOffs.settle(message.requestId);
        break;
      case WORKER_EVENT.REQUEST_ABORT:
        abortRequest(message.requestId);
        break;
      case WORKER_EVENT.REQUEST:
        startRequest(message);
        break;
      case WORKER_EVENT.WS_MESSAGE_RECEIVE:
        receiveWsMessage(env, message);
        break;
      case WORKER_EVENT.WS_CONNECTION_CLOSE:
        closeConnection(message.requestId, message.event);
        break;
    }
  }

  return {
    contexts,

    /** tells the pool the process loaded its worker and takes requests */
    announceReady: () => channel.send({ type: WORKER_EVENT.READY, requestId: '' }),

    /** what the server sends over the IPC channel of node: a connection to hand a request or a response over */
    receiveHandOff: (message: unknown, handedSocket: unknown) => {
      if (isRequestHandOff(message) && handedSocket instanceof net.Socket) startHandedRequest(message, handedSocket);
      else handOffs.receive(message, handedSocket);
    },
  };
}
