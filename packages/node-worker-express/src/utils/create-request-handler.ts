import { Protocols } from '@koeroesi86/node-worker/pool';
import { randomBytes } from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { ParsedUrlQuery } from 'querystring';
import url from 'url';
import type { MiddlewareOptions } from '../types';
import type { ServeRequestOptions } from '../types/serve-request-options';
import buildRequestEvent from './build-request-event';
import type createPathLatency from './create-path-latency';
import type createLeaseAcquirer from './create-lease-acquirer';
import type createSlotCounter from './create-slot-counter';
import type createTargetResolver from './create-target-resolver';
import handleRequestError from './handle-request-error';
import hasBody from './has-body';
import isWebSocket from './is-web-socket';
import { trackRequest, type TrackedRequest } from './metrics';
import prepareRequestBody from './prepare-request-body';
import runInSlot from './run-in-slot';
import serveRequest from './serve-request';
import writeTextResponse from './write-text-response';

// ids only have to differ inside this process, which is cheaper to make than a random uuid
const requestIdPrefix = randomBytes(4).toString('hex');
let requestCount = 0;
const noop = () => {};
const createRequestId = () => `${requestIdPrefix}-${(requestCount += 1).toString(36)}`;

interface RequestHandlerParams {
  options: ServeRequestOptions & Pick<MiddlewareOptions, 'inlineRequestBody'>;
  rootPath: string;
  /** the worker file of the paths that no worker answers */
  staticWorker: string;
  resolveTarget: ReturnType<typeof createTargetResolver>;
  acquireLease: ReturnType<typeof createLeaseAcquirer>;
  pathLatency: Pick<ReturnType<typeof createPathLatency>, 'get'>;
  webSocketSlots: Pick<ReturnType<typeof createSlotCounter>, 'take'>;
}

/** Finds the worker for a request, takes what it needs (a websocket slot, the body) and serves it. What fails before a worker has the request is answered here. */
const createRequestHandler = ({
  options,
  rootPath,
  staticWorker,
  resolveTarget,
  acquireLease,
  pathLatency,
  webSocketSlots,
}: RequestHandlerParams): RequestHandler => {
  const serve = async (request: Request, response: Response, tracked: TrackedRequest, { query, pathname }: { query: ParsedUrlQuery; pathname: string }) => {
    const pathFragments = pathname.split(/\//gi).filter(Boolean);
    const target = await resolveTarget(request, response, pathname, pathFragments);
    if (!target) return;

    const { indexPath, isWorker, pathParameters } = target;
    const protocol = isWebSocket(request) ? Protocols.websocket : Protocols.http;
    const { inlineBody, streamsBody } = await prepareRequestBody(
      request,
      protocol === Protocols.http && hasBody(request) && isWorker,
      options.inlineRequestBody
    );

    if (inlineBody !== undefined && options.limitRequestBody && inlineBody.length > options.limitRequestBody) {
      writeTextResponse(response, 413, 'Request body too large.');
      return;
    }

    const event = buildRequestEvent({ request, protocol, pathname, pathFragments, query, rootPath, pathParameters, streamsBody });

    // a websocket slot is taken before the worker, so connections above the limit do not queue for one
    const served = await runInSlot(
      () => (protocol === Protocols.websocket ? webSocketSlots.take(indexPath) : noop),
      () => {
        // by worker file like the pool, so every static file counts in the static worker's (a missing path answered above only in the totals)
        tracked.path = pathLatency.get(isWorker ? indexPath : staticWorker);
        return acquireLease(response, indexPath, isWorker);
      },
      (lease, releaseSlot) => serveRequest({ request, response, lease, requestId: createRequestId(), event, inlineBody, streamsBody, releaseSlot, options })
    );
    if (!served) writeTextResponse(response, 503, 'Too many connections.', { 'Retry-After': 1 });
  };

  return async (request, response, next) => {
    const { query, pathname } = url.parse(request.url, true);
    const tracked = trackRequest(response);

    try {
      await serve(request, response, tracked, { query, pathname });
    } catch (e) {
      handleRequestError(e, response, next);
    }
  };
};

export default createRequestHandler;
