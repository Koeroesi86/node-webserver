import type { InvokableWorker } from '@koeroesi86/node-worker-pool';
import path from 'path';
import fs from 'fs/promises';
import { StaticOptionsEnv } from './constants';
import decodePath from './utils/decode-path';
import findCacheControl from './utils/find-cache-control';
import isInside from './utils/isInside';
import normalizeStaticOptions from './utils/normalize-static-options';
import notFoundResponse from './utils/not-found-response';
import serveDirectory from './utils/serve-directory';
import serveStaticFile from './utils/serve-static-file';

let timer: NodeJS.Timeout | undefined;

function debounce(fn = () => {}, timeout = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    fn();
  }, timeout);
}

// given by the middleware, the same for the life of the worker
const options = normalizeStaticOptions(process.env[StaticOptionsEnv] ? JSON.parse(process.env[StaticOptionsEnv]) : undefined);

const staticWorker: InvokableWorker = async (event, callback = () => {}) => {
  debounce(
    () => {
      console.log('Exiting static worker.');
      process.exit(0);
    },
    1000 * 60 * 30
  );

  // the file system knows the names decoded; the guard below looks at the decoded path, so `%2e%2e` and `%2f` cannot lead out of the root
  const decodedPath = decodePath(event.path) ?? '';
  const requested = path.resolve(event.rootPath, `.${decodedPath}`);
  // only files below the root are served, anything outside of it (or with a malformed escape) is answered as missing
  const isServable = decodedPath !== '' && ['GET', 'HEAD'].includes(event.httpMethod) && isInside(event.rootPath, requested);
  const fileName = decodedPath.endsWith('/') ? path.join(requested, 'index.html') : requested;
  const stats = isServable ? await fs.stat(fileName).catch(() => undefined) : undefined;

  if (stats?.isFile()) {
    await serveStaticFile({ event, fileName, stats, options, callback });
    return;
  }

  // a folder without an index file is listed when that is asked for, otherwise it is answered as missing
  const isFolder = isServable && options.listDirectories && (await fs.stat(requested).catch(() => undefined))?.isDirectory();

  if (isFolder) {
    await serveDirectory(event, requested, findCacheControl(options.cacheControl, event.path), callback);
    return;
  }

  callback(notFoundResponse());
};

/** loaded by file path in the workers, so it has to stay a CommonJS `module.exports` */
export = staticWorker;
