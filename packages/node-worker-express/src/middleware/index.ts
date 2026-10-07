import { v4 as uuid } from 'uuid';
import path from 'path';
import url from 'url';
import { DefaultOptions, ForbiddenPaths, Protocols, RequestBodyWindow, WORKER_EVENT } from '../constants';
import WorkerPool from '../utils/workerPool';
import isWebSocket from '../utils/isWebSocket';
import parseWsMessage from '../utils/parseWsMessage';
import constructWsMessage from '../utils/constructWsMessage';
import getClientIp from '../utils/getClientIp';
import createBodyParser, { hasBody } from './bodyParser';
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
  // a function, as copying the environment is costly and only needed when a worker is started, not for every request
  const workerOptions = () => ({
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ...config.env },
    cwd: config.cwd,
  });
  const staticWorkerOptions = { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe', 'ipc'] };
  if (config.warmStaticWorker) {
    workerPool.warm(config.staticWorker, staticWorkerOptions);
  }
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

      const requestProtocol = isWebSocket(request) ? Protocols.websocket : Protocols.http;
      const streamsBody =
        isWorker &&
        requestProtocol === Protocols.http &&
        hasBody(request) &&
        (typeof config.streamRequestBody === 'function' ? config.streamRequestBody(indexPath) : config.streamRequestBody);

      // a body that is streamed is not read here: the worker takes it part by part, while the request goes on
      if (!streamsBody) {
        await Promise.race([new Promise((_res, rej) => setTimeout(rej, config.limitRequestTimeout)), new Promise((res) => bodyParser(request, response, res))]);
      }

      const event: RequestEvent = {
        httpMethod: request.method.toUpperCase(),
        protocol: requestProtocol,
        path: pathname,
        pathFragments: pathFragments,
        queryStringParameters: JSON.parse(JSON.stringify(queryStringParameters)),
        headers: request.headers as Record<string, string>,
        remoteAddress: getClientIp(request),
        body: streamsBody ? '' : `${request.body}`,
        rootPath: rootPath,
        ...(streamsBody && { bodyStreamed: true }),
      };

      const limitPerPath = typeof config.limitPerPath === 'function' ? config.limitPerPath(indexPath) : config.limitPerPath;
      const lease = await (isWorker
        ? workerPool.acquire(indexPath, workerOptions, limitPerPath)
        : workerPool.acquire(config.staticWorker, staticWorkerOptions, limitPerPath));
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

      // the response has to keep progressing, either by the worker answering or by the client taking what was written, as a streamed file can take longer than the timeout
      const armResponseTimeout = () => {
        if (event.protocol !== Protocols.http || !config.limitResponseTimeout) return;

        clearTimeout(responseTimer);
        responseTimer = setTimeout(() => failRequest(504, 'Worker did not respond in time.'), config.limitResponseTimeout);
      };

      /** how many parts of the streamed request body the worker has not taken yet */
      let unacknowledged = 0;
      let receivedBytes = 0;

      const forwardBodyPart = (chunk: Buffer) => {
        receivedBytes += chunk.length;

        if (config.limitStreamedRequestBody && receivedBytes > config.limitStreamedRequestBody) {
          response.once('finish', () => request.socket.destroy());
          failRequest(413, 'Request body too large.');
          return;
        }

        worker.postMessage({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: chunk.toString('base64'), isBase64Encoded: true } });
        unacknowledged += 1;
        armResponseTimeout();
        // the worker takes the parts at its pace, so a slow worker slows the upload down instead of filling the memory
        if (unacknowledged >= RequestBodyWindow) request.pause();
      };

      const forwardBodyEnd = () => worker.postMessage({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: null, isBase64Encoded: false } });

      const messageListener = (responseEvent: WorkerOutputEvent) => {
        armResponseTimeout();

        if (responseEvent.type === WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE) {
          unacknowledged -= 1;
          if (unacknowledged < RequestBodyWindow) request.resume();
        }

        // a plain response is not acknowledged: the worker does not wait for it, and every message is a write to the pipe of the worker
        if (responseEvent.type === WORKER_EVENT.RESPONSE) {
          const { event } = responseEvent;
          const bufferEncoding = event.isBase64Encoded ? 'base64' : 'utf8';

          const body = Buffer.from(event.body, bufferEncoding);
          // the size is known, which spares the client a chunked answer and lets a compression middleware see how big it is
          const hasLength = Object.keys(event.headers ?? {}).some((name) => ['content-length', 'transfer-encoding'].includes(name.toLowerCase()));
          response.writeHead(event.statusCode, hasLength ? event.headers : { ...event.headers, 'Content-Length': body.length });
          response.write(body);
          response.end();
        }

        if (responseEvent.type === WORKER_EVENT.RESPONSE_EMIT) {
          const { event } = responseEvent;
          const acknowledge = () => worker.postMessage({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId });

          if (!response.headersSent) {
            response.writeHead(event.statusCode, event.headers);
          }
          if (event.body === null) {
            response.end();
            acknowledge();
          } else {
            // the worker waits for the acknowledgement before it goes on, so a slow client slows the worker down instead of filling the memory
            response.write(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'), () => {
              acknowledge();
              armResponseTimeout();
            });
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
        if (event.protocol === Protocols.http && !response.writableFinished) {
          // a worker that is streaming the response can stop
          worker.postMessage({ type: WORKER_EVENT.REQUEST_ABORT, requestId });
        }
        lease.release();
        if (streamsBody) {
          // what is still to come of the body is read and dropped, a request that is not read keeps its connection stuck
          request.off('data', forwardBodyPart);
          request.off('end', forwardBodyEnd);
          request.resume();
        }
        if (request && request.off) {
          request.off('aborted', cleanupConnection);
        }
        response.off('close', cleanupConnection);

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

      if (streamsBody) {
        request.on('data', forwardBodyPart);
        request.once('end', forwardBodyEnd);
      }

      request.on('aborted', cleanupConnection);
      if (event.protocol === Protocols.http) {
        // the close of the response, as the request closes as soon as its body was read, which says nothing about the client being gone
        response.on('close', cleanupConnection);
        response.on('finish', cleanupConnection);
      }
    } catch (e) {
      next(e);
    }
  };
};

export default workerMiddleware;
