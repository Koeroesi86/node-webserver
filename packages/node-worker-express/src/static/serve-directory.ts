import type { ResponseCallback, WorkerRequestEvent } from '@koeroesi86/node-worker/pool';
import fs from 'fs/promises';
import { ForbiddenPaths } from '../constants';
import { defaultCacheControl } from './find-cache-control';
import notFoundResponse from './not-found-response';
import renderDirectoryListing from './render-directory-listing';

/** a folder is listed under its path with a slash, as the links of the list are relative to it. Leading slashes are dropped so that the location stays on this host. */
const redirectToFolder = (requestPath: string, callback: ResponseCallback) =>
  callback({
    statusCode: 301,
    headers: { Location: `/${requestPath.replace(/^\/+/, '')}/`, 'Content-Length': '0', 'Cache-Control': defaultCacheControl },
    body: '',
    isBase64Encoded: false,
  });

/** Answers a request for a folder with the list of it, without hidden files (starting with a dot) and the forbidden paths. */
const serveDirectory = async (event: WorkerRequestEvent, directory: string, cacheControl: string, callback: ResponseCallback) => {
  if (!event.path.endsWith('/')) return redirectToFolder(event.path, callback);

  const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => undefined);

  if (!dirents) return callback(notFoundResponse());

  const entries = dirents
    .filter(({ name }) => !name.startsWith('.') && !ForbiddenPaths.includes(name))
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  const body = Buffer.from(renderDirectoryListing(event.path, entries));

  return callback({
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, 'Content-Length': String(body.length) },
    body: event.httpMethod === 'HEAD' ? '' : body,
    isBase64Encoded: false,
  });
};

export default serveDirectory;
