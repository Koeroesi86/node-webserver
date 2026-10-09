import { randomBytes } from 'crypto';
import path from 'path';
import url from 'url';
import { DefaultOptions, ForbiddenPaths, Protocols, RequestBodyWindow, WORKER_EVENT } from '../constants';
import WorkerPool from '../utils/workerPool';
import WorkerUnavailableError from '../utils/workerUnavailableError';
import isWebSocket from '../utils/isWebSocket';
import parseWsMessage from '../utils/parseWsMessage';
import constructWsMessage from '../utils/constructWsMessage';
import getClientIp from '../utils/getClientIp';
import hasBody from '../utils/hasBody';
import takeSmallBody from '../utils/takeSmallBody';
import { RequestHandler } from 'express';
import { MiddlewareOptions, RequestEvent, WorkerOutputEvent } from '../types';
import resolvePath from '../utils/resolvePath';
import createProbe from '../utils/createProbe';
import TtlCache from '../utils/ttlCache';
import { getServerMetrics, registerMetricsSource, trackRequest } from '../utils/metrics';

/** how long the way to a path is remembered, and how many paths are, so that a client asking for endless different ones cannot grow the cache */
const routeCacheTtl = 5000;
const routeCacheSize = 10000;

// ids only have to differ inside this process, which is cheaper to make than a random uuid
const requestIdPrefix = randomBytes(4).toString('hex');
let requestCount = 0;
const createRequestId = () => `${requestIdPrefix}-${(requestCount += 1).toString(36)}`;

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
    acquireTimeout: config.limitRequestTimeout,
    maxQueue: config.limitQueue,
    onStdout: config.onStdout,
    onStderr: config.onStderr,
  });
  // a function, as copying the environment is costly and only needed when a worker is started, not for every request
  const workerOptions = () => ({
    env: { ...process.env, ...config.env },
    cwd: config.cwd,
  });
  const staticWorkerOptions = { cwd: process.cwd() };
  if (config.warmStaticWorker) {
    workerPool.warm(config.staticWorker, staticWorkerOptions);
  }
  const routeCache = new TtlCache<{ indexPath: string; isWorker: boolean }>(routeCacheTtl, routeCacheSize);
  const probe = createProbe();
  registerMetricsSource(`workers:${config.name ?? rootPath}`, workerPool.getStats);

  return async (request, response, next) => {
    const { query: queryStringParameters, pathname } = url.parse(request.url, true);
    trackRequest(response);

    try {
      const pathFragments = pathname.split(/\//gi).filter(Boolean);

      if (pathFragments.find((p) => ForbiddenPaths.includes(p))) {
        config.onForbiddenPath(request, response);
        return;
      }

      // a path that was resolved lately is trusted until its entry expires, without asking the file system again
      const cached = routeCache.get(pathname);
      const { indexPath, isWorker, pathExists } = cached ? { ...cached, pathExists: true } : await resolvePath(rootPath, pathFragments, config.index, probe);

      if (pathExists && !cached) {
        routeCache.set(pathname, { indexPath, isWorker });
      }

      const requestProtocol = isWebSocket(request) ? Protocols.websocket : Protocols.http;
      // the static worker has no use for a body, node drops what is not read when the response is done
      const hasWorkerBody = requestProtocol === Protocols.http && hasBody(request) && isWorker;
      // The headers and the first part of the body can come in one chunk, which the parser reads to its end after it told this handler about the request, so what has
      // arrived is only known after that. When the way was found without waiting, a turn of the event loop has to go by (a microtask is not enough, it runs in between).
      if (hasWorkerBody) await new Promise((resolve) => setImmediate(resolve));
      // a body that has arrived with the request and is small goes along with it, which spares the messages of a stream for what is often a few bytes
      const inlineBody = hasWorkerBody ? takeSmallBody(request, config.inlineRequestBody) : undefined;

      if (inlineBody !== undefined && config.limitRequestBody && inlineBody.length > config.limitRequestBody) {
        response.writeHead(413, { 'Content-Type': 'text/plain' });
        response.end('Request body too large.');
        return;
      }

      // the parts of a body that is not inline follow the request
      const streamsBody = hasWorkerBody && inlineBody === undefined;

      const event: RequestEvent = {
        httpMethod: request.method.toUpperCase(),
        protocol: requestProtocol,
        path: pathname,
        pathFragments: pathFragments,
        queryStringParameters: { ...queryStringParameters },
        headers: request.headers as Record<string, string>,
        remoteAddress: getClientIp(request),
        rootPath: rootPath,
        // the body is not part of the event, the worker takes it from a stream while it arrives
        ...(streamsBody && { hasBody: true }),
        ...(inlineBody !== undefined && { inlineBody: inlineBody.toString('base64') }),
      };

      const limitPerPath = typeof config.limitPerPath === 'function' ? config.limitPerPath(indexPath) : config.limitPerPath;
      const lease = await (isWorker
        ? workerPool.acquire(indexPath, workerOptions, limitPerPath)
        : workerPool.acquire(config.staticWorker, staticWorkerOptions, limitPerPath));

      const requestId = createRequestId();

      let firstReceived = false;
      const requestSocketListener = (data) => {
        const frame = parseWsMessage(data);

        // TODO: filter open frame better
        if (data.length === 8 && !firstReceived) {
          firstReceived = true;
          return;
        }

        firstReceived = true;

        lease.send({
          type: WORKER_EVENT.WS_MESSAGE_RECEIVE,
          requestId,
          event: { ...event, frame },
        });
      };
      if (event.protocol === Protocols.websocket) {
        request.socket.on('data', requestSocketListener);
      }

      let responseTimer: NodeJS.Timeout | undefined;
      /** when the response runs out of time, moved forward by every sign of progress, which only costs a number, not a timer */
      let responseDeadline = 0;

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

      const checkResponseTimeout = () => {
        const remaining = responseDeadline - Date.now();

        if (remaining > 0) {
          responseTimer = setTimeout(checkResponseTimeout, remaining);
          return;
        }

        failRequest(504, 'Worker did not respond in time.');
      };

      // the response has to keep progressing, either by the worker answering or by the client taking what was written, as a streamed file can take longer than the timeout
      const armResponseTimeout = () => {
        if (event.protocol !== Protocols.http || !config.limitResponseTimeout) return;

        responseDeadline = Date.now() + config.limitResponseTimeout;
        // one timer for the whole response, that looks again when it fires if there was progress since. After the cleanup the handle is still set, so no new one starts.
        responseTimer ??= setTimeout(checkResponseTimeout, config.limitResponseTimeout);
      };

      /** how many parts of the streamed request body the worker has not taken yet */
      let unacknowledged = 0;
      let receivedBytes = 0;

      const forwardBodyPart = (chunk: Buffer) => {
        receivedBytes += chunk.length;

        if (config.limitRequestBody && receivedBytes > config.limitRequestBody) {
          response.once('finish', () => request.socket.destroy());
          failRequest(413, 'Request body too large.');
          return;
        }

        lease.send({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: chunk } });
        unacknowledged += 1;
        armResponseTimeout();
        // the worker takes the parts at its pace, so a slow worker slows the upload down instead of filling the memory
        if (unacknowledged >= RequestBodyWindow) request.pause();
      };

      const forwardBodyEnd = () => lease.send({ type: WORKER_EVENT.REQUEST_BODY, requestId, event: { body: null } });

      const messageListener = (responseEvent: WorkerOutputEvent) => {
        armResponseTimeout();

        if (responseEvent.type === WORKER_EVENT.METRICS_REQUEST) {
          lease.send({ type: WORKER_EVENT.METRICS, requestId, event: getServerMetrics() });
        }

        if (responseEvent.type === WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE) {
          unacknowledged -= 1;
          if (unacknowledged < RequestBodyWindow) request.resume();
        }

        // a plain response is not acknowledged: the worker does not wait for it, and every message is a write to the pipe of the worker
        if (responseEvent.type === WORKER_EVENT.RESPONSE) {
          const { event } = responseEvent;
          const body = event.body ?? Buffer.alloc(0);
          // the size is known, which spares the client a chunked answer and lets a compression middleware see how big it is
          const hasLength = Object.keys(event.headers ?? {}).some((name) => ['content-length', 'transfer-encoding'].includes(name.toLowerCase()));
          response.writeHead(event.statusCode, hasLength ? event.headers : { ...event.headers, 'Content-Length': body.length });
          response.write(body);
          response.end();
        }

        if (responseEvent.type === WORKER_EVENT.RESPONSE_EMIT) {
          const { event } = responseEvent;
          const acknowledge = () => lease.send({ type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE, requestId });

          if (!response.headersSent) {
            response.writeHead(event.statusCode, event.headers);
          }
          if (event.body === null) {
            response.end();
            acknowledge();
          } else {
            // the worker waits for the acknowledgement before it goes on, so a slow client slows the worker down instead of filling the memory
            response.write(event.body ?? Buffer.alloc(0), () => {
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
        lease.send({
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
          lease.send({ type: WORKER_EVENT.REQUEST_ABORT, requestId });
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
      lease.send({
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
      if (e instanceof WorkerUnavailableError && !response.headersSent) {
        // the details name a file of the server, the client only needs to know when to come back
        response.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': Math.max(1, Math.ceil(e.retryAfterMs / 1000)) });
        response.end('Service unavailable.');
        return;
      }
      next(e);
    }
  };
};

export default workerMiddleware;
