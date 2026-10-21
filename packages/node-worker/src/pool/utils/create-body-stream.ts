import { Readable } from 'stream';
import type { WorkerOutputEvent } from '../types';
import createEmptyBody from './create-empty-body';
import createUpload from './create-upload';
import type { Channel } from './createChannel';
import type { RequestContexts } from './create-request-contexts';

/** the stream of the body of a request: the parts that follow, the one that came with the request, or no bytes */
export default function createBodyStream(
  contexts: RequestContexts,
  channel: Channel<WorkerOutputEvent>,
  requestId: string,
  hasBody: boolean | undefined,
  body: Buffer | undefined
) {
  if (hasBody) return createUpload(contexts, channel, requestId);

  return body?.length ? Readable.from([body], { objectMode: false }) : createEmptyBody();
}
