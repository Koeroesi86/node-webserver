import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { availableParallelism } from 'os';
import LambdaPool, { LambdaRequestAbandonedError, LambdaUnavailableError } from '../classes/LambdaPool';
import RequestBodyTooLargeError from '../classes/RequestBodyTooLargeError';
import {
  DEFAULT_LIMIT_REQUEST_BODY,
  DEFAULT_TIMEOUT,
  MESSAGE_ENDPOINT_TIMED_OUT,
  MESSAGE_INTERNAL_SERVER_ERROR,
  MESSAGE_PAYLOAD_TOO_LARGE,
  MESSAGE_SERVICE_UNAVAILABLE,
} from '../constants';
import { isRegistered, getRegisteredPath } from '../registry';
import createRequestEvent from '../utils/create-request-event';
import createResponseHeaders from '../utils/create-response-headers';
import invokeLambda from '../utils/invoke-lambda';
import isValidResponse from '../utils/is-valid-response';
import readRequestBody from '../utils/read-request-body';
import sweepLambdaFolders from '../utils/sweep-lambda-folders';
import writeError from '../utils/write-error';
import type ResponseEvent from '../classes/ResponseEvent';
import type { Communication, HttpMiddlewareOptions, StorageDriverConstructor } from '../types';

export type HttpMiddleware = (request: IncomingMessage, response: ServerResponse, next?: () => void) => void;

const writeResponse = (response: ServerResponse, responseEvent: ResponseEvent) => {
  if (!isValidResponse(responseEvent)) {
    writeError(response, 502, MESSAGE_INTERNAL_SERVER_ERROR);
    return;
  }

  response.writeHead(responseEvent.statusCode, createResponseHeaders(responseEvent));

  if (!responseEvent.body) {
    response.end();
    return;
  }

  const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
  response.end(Buffer.from(responseEvent.body, bufferEncoding));
};

function createHttpMiddleware(options: HttpMiddlewareOptions): HttpMiddleware {
  const {
    lambdaPath,
    handlerKey = 'handler',
    logger = () => {},
    limit = availableParallelism(),
    acquireTimeout,
    startTimeout,
    timeout = DEFAULT_TIMEOUT,
    limitRequestBody = DEFAULT_LIMIT_REQUEST_BODY,
    env,
    restrictFileSystem,
    communication = {},
  } = options;
  const currentCommunication: Communication = !communication.type ? { type: 'ipc' } : { ...communication };
  const storagePath = isRegistered(currentCommunication.type ?? '') ? getRegisteredPath(currentCommunication.type) : currentCommunication.path;
  if (!storagePath) {
    return (req, res, next) => {
      next?.();
    };
  }

  const StorageDriver: StorageDriverConstructor = require(storagePath);
  if (StorageDriver.start) StorageDriver.start();
  sweepLambdaFolders();
  const lambdaPool = new LambdaPool({
    lambdaPath,
    handlerKey,
    limit,
    acquireTimeout,
    startTimeout,
    timeout,
    restrictFileSystem,
    env,
    logger,
    communication: currentCommunication,
  });
  return (request, response) => {
    const requestId = randomUUID();

    logger('Invoking lambda', `${lambdaPath}#${handlerKey}`);

    // a client that goes away while its request waits for a lambda leaves the line, instead of taking a lambda that nobody reads the answer of
    const clientGone = new AbortController();
    const onClose = () => {
      if (!response.writableFinished) clientGone.abort();
    };
    response.once('close', onClose);

    const handleRequest = async () => {
      // read before a lambda is taken, so that a slow upload does not hold one
      const body = await readRequestBody(request, limitRequestBody);
      const requestEvent = createRequestEvent(request, requestId, body);
      const lambdaInstance = await lambdaPool.getLambda(clientGone.signal);

      if (clientGone.signal.aborted) {
        lambdaPool.release(lambdaInstance);
        return;
      }

      const storage = new StorageDriver(requestId, lambdaInstance, lambdaInstance.storageFolder);
      const outcome = await invokeLambda(lambdaInstance, requestId, requestEvent, timeout);

      if (outcome.type === 'response') writeResponse(response, outcome.responseEvent);
      if (outcome.type === 'closed') writeError(response, 502, MESSAGE_INTERNAL_SERVER_ERROR);
      if (outcome.type === 'timeout') {
        writeError(response, 504, MESSAGE_ENDPOINT_TIMED_OUT);
        // it is still busy with the request, and the pool lets go of it once it is gone
        lambdaInstance.terminate('SIGKILL');
      }

      return storage.destroy();
    };

    handleRequest()
      .catch((err) => {
        if (err instanceof LambdaRequestAbandonedError) return;

        if (err instanceof RequestBodyTooLargeError) {
          // the rest of the body is not read, so the connection is closed once the answer is out
          response.setHeader('Connection', 'close');
          response.once('finish', () => request.destroy());
          writeError(response, 413, MESSAGE_PAYLOAD_TOO_LARGE);
          return;
        }

        // the client went away halfway through the body, there is nobody to answer
        if (!response.writable) return;

        logger(err);
        // the lambdas that may run are all busy
        if (err instanceof LambdaUnavailableError) writeError(response, 503, MESSAGE_SERVICE_UNAVAILABLE);
        else writeError(response, 502, MESSAGE_INTERNAL_SERVER_ERROR);
      })
      .finally(() => response.off('close', onClose));
  };
}

export default createHttpMiddleware;
