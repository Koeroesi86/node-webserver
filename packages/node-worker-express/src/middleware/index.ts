import { v4 as uuid } from 'uuid';
import path from 'path';
import url from 'url';
import { DefaultOptions, ForbiddenPaths, Protocols, WORKER_EVENT } from '../constants';
import WorkerPool from '../utils/workerPool';
import isWebSocket from '../utils/isWebSocket';
import parseWsMessage from '../utils/parseWsMessage';
import constructWsMessage from '../utils/constructWsMessage';
import getClientIp from '../utils/getClientIp';
import createBodyParser from './bodyParser';
import { RequestHandler } from 'express';
import { MiddlewareOptions, RequestEvent, WorkerOutputEvent } from '../types';
import resolvePath from '../utils/resolvePath';
import fileExists from '../utils/fileExists';

const workerMiddleware = (options: MiddlewareOptions): RequestHandler => {
  const config = {
    ...DefaultOptions,
    ...(options && options),
  };
  if (!config.root) {
    throw new Error('No root path defined in configuration!');
  }
  const rootPath = path.resolve(config.root);
  const workerPool = new WorkerPool({
    overallLimit: config.limit,
    onExit: config.onExit,
    idleCheckTimeout: config.idleCheckTimeout,
    acquireTimeout: config.limitRequestTimeout,
  });
  const bodyParser = createBodyParser({ limitRequestBody: config.limitRequestBody, shouldError: true });
  const aliasCache = new Map<string, string>();
  const workerCache = new Map<string, string>();

  return async (request, response, next) => {
    const { query: queryStringParameters, pathname } = url.parse(request.url, true);

    try {
      let isWorker = false;
      const pathFragments = pathname.split(/\//gi).filter(Boolean);
      let currentPathFragments = pathFragments.slice(0);
      let pathExists = false;

      if (pathFragments.find((p) => ForbiddenPaths.includes(p))) {
        config.onForbiddenPath(request, response);
        return;
      }

      await Promise.race([new Promise((_res, rej) => setTimeout(rej, config.limitRequestTimeout)), new Promise((res) => bodyParser(request, response, res))]);
      let indexPath: string;
      // the cache entries expire on a timer, so read them once before awaiting anything
      const cachedAliasPath = aliasCache.get(pathname);
      const cachedWorkerPath = workerCache.get(pathname);

      if (cachedAliasPath && (await fileExists(cachedAliasPath))) {
        isWorker = false;
        indexPath = cachedAliasPath;
        pathExists = true;
      } else if (cachedWorkerPath && (await fileExists(cachedWorkerPath))) {
        isWorker = true;
        indexPath = cachedWorkerPath;
        pathExists = true;
      } else {
        const resolved = await resolvePath(rootPath, currentPathFragments, config.index);
        indexPath = resolved.indexPath;
        isWorker = resolved.isWorker;
        pathExists = resolved.pathExists;
      }

      if (!pathExists) {
        //
      } else if (isWorker && !workerCache.has(pathname)) {
        workerCache.set(pathname, indexPath);
        setTimeout(() => workerCache.delete(pathname), 5000);
      } else if (!isWorker && !aliasCache.has(pathname)) {
        aliasCache.set(pathname, indexPath);
        setTimeout(() => aliasCache.delete(pathname), 5000);
      }

      const event: RequestEvent = {
        httpMethod: request.method.toUpperCase(),
        protocol: isWebSocket(request) ? Protocols.websocket : Protocols.http,
        path: pathname,
        pathFragments: pathFragments,
        queryStringParameters: JSON.parse(JSON.stringify(queryStringParameters)),
        headers: request.headers as Record<string, string>,
        remoteAddress: getClientIp(request),
        body: `${request.body}`,
        rootPath: rootPath,
      };

      const limitPerPath = typeof config.limitPerPath === 'function' ? config.limitPerPath(indexPath) : config.limitPerPath;
      const lease = await (isWorker
        ? workerPool.acquire(
            indexPath,
            {
              stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
              env: { ...process.env, ...config.env },
              cwd: config.cwd,
            },
            limitPerPath
          )
        : workerPool.acquire(
            config.staticWorker,
            {
              cwd: process.cwd(),
              stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            },
            limitPerPath
          ));
      const { worker } = lease;

      const requestId = uuid();

      let firstReceived = false;
      const requestSocketListener = (data) => {
        const frame = parseWsMessage(data);

        // TODO: filter open frame better
        if (data.length === 8 && !firstReceived) {
          firstReceived = true;
          return;
        }

        firstReceived = true;

        worker.postMessage({
          type: WORKER_EVENT.WS_MESSAGE_RECEIVE,
          requestId,
          event: { ...event, frame },
        });
      };
      if (event.protocol === Protocols.websocket) {
        request.socket.on('data', requestSocketListener);
      }

      worker.instance.stdout.off('data', config.onStdout);
      worker.instance.stdout.on('data', config.onStdout);

      worker.instance.stderr.off('data', config.onStderr);
      worker.instance.stderr.on('data', config.onStderr);

      let responseTimer: NodeJS.Timeout | undefined;

      const failRequest = (statusCode: number, message: string) => {
        if (event.protocol === Protocols.websocket) {
          request.socket.destroy();
        } else if (!response.headersSent) {
          response.writeHead(statusCode, { 'Content-Type': 'text/plain' });
          response.end(message);
        } else {
          response.destroy();
        }
        cleanupConnection();
      };

      // the worker has to keep answering while a response is going on, an emitted file can take longer than the timeout
      const armResponseTimeout = () => {
        if (event.protocol !== Protocols.http || !config.limitResponseTimeout) return;

        clearTimeout(responseTimer);
        responseTimer = setTimeout(() => failRequest(504, 'Worker did not respond in time.'), config.limitResponseTimeout);
      };

      const messageListener = (responseEvent: WorkerOutputEvent) => {
        armResponseTimeout();

        if (responseEvent.type === WORKER_EVENT.RESPONSE) {
          worker.postMessage({
            type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE,
            requestId,
          });
          const { event } = responseEvent;
          const bufferEncoding = event.isBase64Encoded ? 'base64' : 'utf8';

          response.writeHead(event.statusCode, event.headers);
          response.write(Buffer.from(event.body, bufferEncoding));
          response.end();
        }

        if (responseEvent.type === WORKER_EVENT.RESPONSE_EMIT) {
          worker.postMessage({
            type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE,
            requestId,
          });
          const { event } = responseEvent;
          const bufferEncoding = event.isBase64Encoded ? 'base64' : 'utf8';

          if (!response.headersSent) {
            response.writeHead(event.statusCode, event.headers);
          }
          if (event.body !== null) {
            response.write(Buffer.from(event.body, bufferEncoding).toString());
          } else {
            response.end();
          }
        }

        if (responseEvent.type === WORKER_EVENT.WS_MESSAGE_SEND) {
          request.socket.write(constructWsMessage(responseEvent.event.frame));
        }
      };

      const requestCloseListener = () => {
        worker.postMessage({
          type: WORKER_EVENT.WS_CONNECTION_CLOSE,
          requestId,
          event,
        });
        cleanupConnection();
      };
      request.socket.on('close', requestCloseListener);

      function cleanupConnection() {
        clearTimeout(responseTimer);
        lease.release();
        if (request && request.off) {
          request.off('close', cleanupConnection);
          request.off('aborted', cleanupConnection);
        }

        if (request.socket && request.socket.off) {
          request.socket.off('data', requestSocketListener);
          request.socket.off('close', requestCloseListener);
        }
      }

      lease.subscribe(requestId, messageListener, () => failRequest(502, 'Worker exited.'));
      armResponseTimeout();
      worker.postMessage({
        type: WORKER_EVENT.REQUEST,
        requestId,
        event,
      });

      request.on('aborted', cleanupConnection);
      if (event.protocol === Protocols.http) {
        request.on('close', cleanupConnection);
        response.on('finish', cleanupConnection);
      }
    } catch (e) {
      next(e);
    }
  };
};

export default workerMiddleware;
