import type { Readable } from 'stream';
import type { RequestEvent } from '../types';
import type { ServerMetrics } from './metrics';

/** the parts of a streamed response that wait to be written by the parent */
export interface Stream {
  waiting: Array<(proceed: boolean) => void>;
  aborted: boolean;
}

/** everything a worker process keeps for one request, which the messages of the server find by the request */
export interface RequestContext {
  /** the stream of the response, which the acknowledgements of the parent find */
  stream?: Stream;
  /** the open websocket connection: the request it was upgraded by, and the stream that holds the messages sent to the client which it has not taken yet */
  webSocket?: { event: RequestEvent; stream: Stream };
  /** the messages of a client are handled one after the other, in the order they came in: the end of the last one that was started */
  receiving?: Promise<void>;
  /** the streamed request body that is still coming in */
  upload?: { stream: Readable; receive: (part: { body: Buffer | null }) => void };
  /** the workers that wait for the metrics of the server: the answers come in the order of the questions */
  metricsWaiting: Array<(metrics: ServerMetrics) => void>;
}

export type RequestContexts = ReturnType<typeof createRequestContexts>;

const isEmpty = ({ stream, webSocket, receiving, upload, metricsWaiting }: RequestContext) =>
  !stream && !webSocket && !receiving && !upload && metricsWaiting.length === 0;

/** the contexts of the requests in flight, by request. A context is dropped once nothing is left in it. */
export default function createRequestContexts() {
  const contexts = new Map<string, RequestContext>();

  const release = (requestId: string) => {
    const context = contexts.get(requestId);
    if (context && isEmpty(context)) contexts.delete(requestId);
  };

  return {
    get: (requestId: string) => contexts.get(requestId),

    /** the context of the request, which is created when there is none yet */
    open: (requestId: string) => {
      const context = contexts.get(requestId) ?? { metricsWaiting: [] };
      contexts.set(requestId, context);

      return context;
    },

    /** changes the context of the request, if there is one, and drops it when the change left it empty */
    change: (requestId: string, mutate: (context: RequestContext) => void) => {
      const context = contexts.get(requestId);
      if (!context) return;

      mutate(context);
      release(requestId);
    },

    release,

    get size() {
      return contexts.size;
    },
  };
}
