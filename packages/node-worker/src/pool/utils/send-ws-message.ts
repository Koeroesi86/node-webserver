import { ChannelMaxFrameLength, WORKER_EVENT } from '../constants';
import type { WSFrameEvent } from '../types';
import type { Stream } from './create-request-contexts';
import type { WorkerEnvironment } from './worker-environment';

/**
 * sends a message (or the end) to a websocket client. The promise resolves with `true` once the server has written the message to the client,
 * and with `false` when the connection is gone, so a worker that awaits it sends no faster than the client takes.
 */
export default function sendWsMessage(
  { channel, isWritable, contexts }: WorkerEnvironment,
  requestId: string,
  stream: Stream | undefined,
  { frame, close }: WSFrameEvent
) {
  if (!stream || stream.aborted) return Promise.resolve(false);

  // the acknowledgements find the stream by the request
  contexts.open(requestId).stream = stream;
  const sent = channel.send({
    type: WORKER_EVENT.WS_MESSAGE_SEND,
    requestId,
    event: {
      ...(frame !== undefined && { body: frame }),
      ...(close && { close }),
    },
  });
  if (!sent && isWritable()) {
    console.error(new Error(`A websocket message of ${requestId} is bigger than the ${ChannelMaxFrameLength} bytes a message may have.`));
  }

  return frame === undefined || !sent ? Promise.resolve(false) : new Promise<boolean>((resolve) => stream.waiting.push(resolve));
}
