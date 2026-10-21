import type { ResponseCallback, ResponseEvent, WorkerRequestEvent } from '@koeroesi86/node-worker/pool';
import { createReadStream } from 'fs';
import type { Stats } from 'fs';
import { StaticStreamThreshold } from '../constants';
import streamResponse from '../streamResponse';
import chooseStaticAnswer from './choose-static-answer';
import findCacheControl from './find-cache-control';
import findPrecompressed from './find-precompressed';
import getFileInfo, { getEtag } from './getFileInfo';
import type { NormalizedStaticOptions } from './normalize-static-options';
import type { ByteRange } from './parse-range';
import readSmallFile from './read-small-file';

const chunkSize = 1024 * 1024;

interface ServeStaticFileParams {
  event: WorkerRequestEvent;
  fileName: string;
  stats: Stats;
  options: NormalizedStaticOptions;
  callback: ResponseCallback;
}

/** Sends the file (or the bytes of the range) in parts and waits for the client to take them, it stops when the client is gone. */
const streamFile = (fileName: string, response: ResponseEvent, callback: ResponseCallback, range?: ByteRange) =>
  streamResponse(callback, response, createReadStream(fileName, { highWaterMark: chunkSize, ...range }));

/**
 * Answers a request for a file: the whole of it, or the part a `Range` header asks for (one range, `If-Range` respected), with `Content-Encoding` when a precompressed
 * variant of it is sent. Files above `StaticStreamThreshold` are streamed, also their ranges, smaller ones are sent from memory.
 */
const serveStaticFile = async ({ event, fileName, stats, options, callback }: ServeStaticFileParams) => {
  const { contentType, charset } = await getFileInfo(fileName, stats);
  const { varies, chosen } = await findPrecompressed(fileName, event.headers['accept-encoding'], options.precompressed);
  // the variant is what is sent, so it is what the validators and the range are about
  const sent = chosen?.stats ?? stats;
  const sentName = chosen?.fileName ?? fileName;
  const etag = getEtag(sent);
  const { statusCode, headers, range, hasBody } = chooseStaticAnswer(event.headers, etag, sent);
  const response: ResponseEvent = {
    statusCode,
    headers: {
      'Content-Type': `${contentType}${charset ? `; charset=${charset}` : ''}`,
      'Cache-Control': findCacheControl(options.cacheControl, event.path),
      'Accept-Ranges': 'bytes',
      ...headers,
      ...(chosen && { 'Content-Encoding': chosen.encoding }),
      ...(varies && { Vary: 'Accept-Encoding' }),
      ETag: etag,
      'Last-Modified': sent.mtime.toUTCString(),
    },
    body: '',
    isBase64Encoded: false,
  };

  if (!hasBody || event.httpMethod === 'HEAD') {
    callback(response);
  } else if (sent.size > StaticStreamThreshold) {
    await streamFile(sentName, response, callback, range);
  } else {
    const body = await readSmallFile(sentName, sent);
    callback({ ...response, body: range ? body.subarray(range.start, range.end + 1) : body });
  }
};

export default serveStaticFile;
