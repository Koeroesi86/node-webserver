import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { StaticStreamThreshold } from './constants';
import { InvokableWorker, ResponseCallback, ResponseEvent } from './types';
import getFileInfo from './utils/getFileInfo';
import isInside from './utils/isInside';
import isNotModified from './utils/isNotModified';

let timer: NodeJS.Timeout | undefined;

const chunkSize = 64 * 1024;
/** parts that may wait to be written to the client while the next ones are read */
const streamWindow = 4;

function debounce(fn = () => {}, timeout = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    fn();
  }, timeout);
}

const proceeds = (result: unknown) => result !== false;

/** Sends the file in parts and waits for the client to take them, it stops when the client is gone. */
async function streamFile(fileName: string, response: ResponseEvent, callback: ResponseCallback) {
  const stream = createReadStream(fileName, { highWaterMark: chunkSize });
  const written: Array<Promise<unknown>> = [];

  try {
    for await (const chunk of stream) {
      written.push(Promise.resolve(callback({ ...response, emit: true, body: chunk.toString('base64'), isBase64Encoded: true })));
      if (written.length >= streamWindow && !proceeds(await written.shift())) return;
    }
  } catch (error) {
    // the headers are out, so the best left to do is ending the response early, which the client sees as a truncated one
    console.error(error);
  } finally {
    stream.destroy();
  }

  written.push(Promise.resolve(callback({ ...response, emit: true, body: null, isBase64Encoded: false })));
  await Promise.all(written);
}

const staticWorker: InvokableWorker = async (event, callback = () => {}) => {
  debounce(() => {
    console.log('Exiting static worker.');
    process.exit(0);
  }, 1000 * 60 * 30);

  const currentPath = `${event.path}${/\/$/.test(event.path) ? 'index.html' : ''}`;
  const fileName = path.resolve(event.rootPath, `.${currentPath}`);
  // only files below the root are served, a directory or anything outside of it is answered as missing
  const stats = ['GET', 'HEAD'].includes(event.httpMethod) && isInside(event.rootPath, fileName) ? await fs.stat(fileName).catch(() => undefined) : undefined;

  if (!stats?.isFile()) {
    callback({
      statusCode: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=0',
      },
      body: `${event.path} does not exist`,
      isBase64Encoded: false,
    });
    return;
  }

  // TODO: range request
  const { etag, contentType, charset } = await getFileInfo(fileName, stats);
  const notModified = isNotModified(event.headers, etag, stats.mtimeMs);
  const response: ResponseEvent = {
    statusCode: notModified ? 304 : 200,
    headers: {
      'Content-Type': `${contentType}${charset ? `; charset=${charset}` : ''}`,
      'Cache-Control': 'public, max-age=0',
      ...(!notModified && { 'Content-Length': String(stats.size) }),
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString(),
    },
    body: '',
    isBase64Encoded: false,
  };

  if (notModified || event.httpMethod === 'HEAD') {
    callback(response);
  } else if (stats.size > StaticStreamThreshold) {
    await streamFile(fileName, response, callback);
  } else {
    callback({ ...response, body: (await fs.readFile(fileName)).toString('base64'), isBase64Encoded: true });
  }
};

export default staticWorker;
