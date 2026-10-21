import type { Readable } from 'stream';
import type { RequestEvent, WorkerRequestEvent } from '../types';
import type { ServerMetrics } from '../types';

/** what a worker is called with, the websocket frames and the closing of a connection too */
export default function createWorkerEvent(
  event: RequestEvent,
  requestId: string,
  bodyStream: Readable,
  getMetrics: () => Promise<ServerMetrics>,
  body?: Buffer
): WorkerRequestEvent {
  const workerEvent: WorkerRequestEvent = { ...event, requestId, bodyStream, getMetrics };
  // workers read the body that came with the request as base64 before it travelled as bytes: encoded only when read, so nobody pays for it who does not
  if (body !== undefined) Object.defineProperty(workerEvent, 'inlineBody', { get: () => body.toString('base64'), enumerable: true });

  return workerEvent;
}
