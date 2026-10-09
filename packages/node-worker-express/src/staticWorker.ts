import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { StaticStreamThreshold } from './constants';
import { InvokableWorker, ResponseCallback, ResponseEvent } from './types';
import streamResponse from './streamResponse';
import getFileInfo from './utils/getFileInfo';
import isInside from './utils/isInside';
import isNotModified from './utils/isNotModified';
import notFoundResponse from './utils/not-found-response';

let timer: NodeJS.Timeout | undefined;

const chunkSize = 1024 * 1024;

function debounce(fn = () => {}, timeout = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    fn();
  }, timeout);
}

/** Sends the file in parts and waits for the client to take them, it stops when the client is gone. */
const streamFile = (fileName: string, { statusCode, headers }: ResponseEvent, callback: ResponseCallback) =>
  streamResponse(callback, { statusCode, headers }, createReadStream(fileName, { highWaterMark: chunkSize }));

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
    callback(notFoundResponse(event.path));
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
    callback({ ...response, body: await fs.readFile(fileName) });
  }
};

/** loaded by file path in the workers, so it has to stay a CommonJS `module.exports` */
export = staticWorker;
