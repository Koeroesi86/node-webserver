import { randomUUID } from 'node:crypto';
import url from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { availableParallelism } from 'os';
import LambdaPool, { LambdaUnavailableError } from '../classes/LambdaPool';
import RequestEvent from '../classes/RequestEvent';
import { isRegistered, getRegisteredPath } from '../registry';
import type ResponseEvent from '../classes/ResponseEvent';
import type { Communication, HttpMiddlewareOptions, Storage, StorageDriverConstructor } from '../types';

export type HttpMiddleware = (request: IncomingMessage, response: ServerResponse, next?: () => void) => void;

const writeResponse = (response: ServerResponse, responseEvent: ResponseEvent) => {
  if (!responseEvent.statusCode) return;

  response.writeHead(responseEvent.statusCode, responseEvent.headers);

  if (!responseEvent.body) {
    response.end();
    return;
  }

  const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
  response.end(Buffer.from(responseEvent.body, bufferEncoding));
};

function createHttpMiddleware(options: HttpMiddlewareOptions): HttpMiddleware {
  const { lambdaPath, handlerKey = 'handler', logger = () => {}, limit = availableParallelism(), acquireTimeout, communication = {} } = options;
  const currentCommunication: Communication = !communication.type ? { type: 'ipc' } : { ...communication };
  const storagePath = isRegistered(currentCommunication.type ?? '') ? getRegisteredPath(currentCommunication.type) : currentCommunication.path;
  // TODO: tmp folders
  if (!storagePath) {
    return (req, res, next) => {
      next?.();
    };
  }

  const StorageDriver: StorageDriverConstructor = require(storagePath);
  if (StorageDriver.start) StorageDriver.start();
  const lambdaPool = new LambdaPool({ overallLimit: limit, acquireTimeout, logger, communication: currentCommunication });
  return (request, response) => {
    const { query: queryStringParameters, pathname: path } = url.parse(request.url ?? '', true);

    const requestEvent = new RequestEvent();
    requestEvent.httpMethod = request.method?.toUpperCase() ?? '';
    requestEvent.path = path ?? '';
    requestEvent.queryStringParameters = queryStringParameters;
    requestEvent.headers = request.headers;

    const requestId = randomUUID();
    let storage: Storage | undefined;

    logger('Invoking lambda', `${lambdaPath}#${handlerKey}`);

    const closeListener = () => {
      // the lambda exited without answering
      if (!response.headersSent) response.writeHead(502);
      if (!response.writableEnded) response.end();
      if (storage) storage.destroy();
    };

    const handleRequest = async () => {
      const lambdaInstance = await lambdaPool.getLambda(lambdaPath, handlerKey);
      lambdaInstance.addEventListenerOnce('close', closeListener);

      const currentStorage = new StorageDriver(requestId, lambdaInstance);
      storage = currentStorage;
      const responseEvent = await new Promise<ResponseEvent>((res) => lambdaInstance.invoke(requestId, requestEvent, res));

      writeResponse(response, responseEvent);

      lambdaInstance.removeEventListener('close', closeListener);
      return currentStorage.destroy();
    };

    handleRequest().catch((err) => {
      logger(err);
      // the lambdas that may run are all busy
      response.writeHead(err instanceof LambdaUnavailableError ? 503 : 500);
      response.write(err instanceof LambdaUnavailableError ? 'No lambda available.' : 'Something went wrong.');
      response.end();
    });
  };
}

export default createHttpMiddleware;
