import type { RequestContexts } from './create-request-contexts';

/** the connection is gone: what the worker waits for will not come */
export default function closeWsConnection(contexts: RequestContexts, requestId: string) {
  const stream = contexts.get(requestId)?.webSocket?.stream;
  contexts.change(requestId, (context) => {
    context.webSocket = undefined;
    context.receiving = undefined;
  });
  if (!stream) return;

  stream.aborted = true;
  stream.waiting.splice(0).forEach((resolve) => resolve(false));
  contexts.change(requestId, (context) => {
    if (context.stream === stream) context.stream = undefined;
  });
}
