import type { WorkerLease } from '@koeroesi86/node-worker/pool';
import type { Request, Response } from 'express';
import createRequestHandler from './create-request-handler';
import prepareRequestBody from './prepare-request-body';
import serveRequest from './serve-request';
import writeTextResponse from './write-text-response';

jest.mock('./serve-request', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./write-text-response', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./prepare-request-body', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./build-request-event', () => ({ __esModule: true, default: jest.fn((params) => ({ built: params.pathname })) }));
jest.mock('./metrics', () => ({ trackRequest: jest.fn(() => ({})) }));

const lease = { name: 'lease' } as unknown as WorkerLease;
const request = (headers: Record<string, string> = {}, method = 'GET') => ({ url: '/a/b?x=1', method, headers }) as unknown as Request;
const response = {} as Response;
const target = (indexPath: string, isWorker: boolean) => ({ indexPath, isWorker, pathParameters: {}, targetExists: true });

const setup = (overrides: Partial<Parameters<typeof createRequestHandler>[0]> = {}) => {
  const params = {
    options: { inlineRequestBody: 10, limitRequestBody: 0 },
    rootPath: '/root',
    staticWorker: '/static.js',
    resolveTarget: jest.fn(() => Promise.resolve(target('/root/a/index.js', true))),
    acquireLease: jest.fn(() => Promise.resolve(lease)),
    pathLatency: { get: jest.fn() },
    webSocketSlots: { take: jest.fn(() => jest.fn()) },
    ...overrides,
  };

  return { params, handler: createRequestHandler(params), next: jest.fn() };
};

describe('createRequestHandler', () => {
  beforeEach(() => {
    jest.mocked(prepareRequestBody).mockResolvedValue({ inlineBody: undefined, streamsBody: false });
  });

  afterEach(() => jest.clearAllMocks());

  it('serves the request with the lease and the event for it', async () => {
    const { handler, next, params } = setup();

    await handler(request(), response, next);

    expect(params.resolveTarget).toHaveBeenCalledWith(expect.anything(), response, '/a/b', ['a', 'b']);
    expect(serveRequest).toHaveBeenCalledWith(expect.objectContaining({ lease, response, event: { built: '/a/b' }, options: params.options }));
    expect(next).not.toHaveBeenCalled();
  });

  it('gives every request its own id', async () => {
    const { handler, next } = setup();

    await handler(request(), response, next);
    await handler(request(), response, next);

    const [first, second] = jest.mocked(serveRequest).mock.calls.map(([call]) => call.requestId);
    expect(first).not.toEqual(second);
  });

  it('does nothing more when no target was found, the resolver answered', async () => {
    const { handler, next, params } = setup({ resolveTarget: jest.fn(() => Promise.resolve(undefined)) });

    await handler(request(), response, next);

    expect(params.acquireLease).not.toHaveBeenCalled();
    expect(serveRequest).not.toHaveBeenCalled();
  });

  it('only takes a body for a request that a worker answers', async () => {
    const { handler, next } = setup({ resolveTarget: jest.fn(() => Promise.resolve(target('/root/a.txt', false))) });

    await handler(request({ 'content-length': '3' }, 'POST'), response, next);

    expect(prepareRequestBody).toHaveBeenCalledWith(expect.anything(), false, 10);
  });

  it('takes the body of a request with one for a worker', async () => {
    const { handler, next } = setup();

    await handler(request({ 'content-length': '3' }, 'POST'), response, next);

    expect(prepareRequestBody).toHaveBeenCalledWith(expect.anything(), true, 10);
  });

  it('answers 413 when the body that arrived is above the limit', async () => {
    jest.mocked(prepareRequestBody).mockResolvedValue({ inlineBody: Buffer.alloc(5), streamsBody: false });
    const { handler, next, params } = setup({ options: { inlineRequestBody: 10, limitRequestBody: 4 } });

    await handler(request({ 'content-length': '5' }, 'POST'), response, next);

    expect(writeTextResponse).toHaveBeenCalledWith(response, 413, 'Request body too large.');
    expect(params.acquireLease).not.toHaveBeenCalled();
  });

  it('counts the request in the latency of its worker file, or of the static worker', async () => {
    const worker = setup();
    await worker.handler(request(), response, worker.next);
    const files = setup({ resolveTarget: jest.fn(() => Promise.resolve(target('/root/a.txt', false))) });
    await files.handler(request(), response, files.next);

    expect(worker.params.pathLatency.get).toHaveBeenCalledWith('/root/a/index.js');
    expect(files.params.pathLatency.get).toHaveBeenCalledWith('/static.js');
  });

  it('takes a websocket slot for an upgrade request and answers 503 when none is left', async () => {
    const { handler, next, params } = setup({ webSocketSlots: { take: jest.fn(() => undefined) } });

    await handler(request({ upgrade: 'websocket', connection: 'Upgrade' }), response, next);

    expect(params.webSocketSlots.take).toHaveBeenCalledWith('/root/a/index.js');
    expect(writeTextResponse).toHaveBeenCalledWith(response, 503, 'Too many connections.', { 'Retry-After': 1 });
    expect(serveRequest).not.toHaveBeenCalled();
  });

  it('takes no websocket slot for a plain request', async () => {
    const { handler, next, params } = setup();

    await handler(request(), response, next);

    expect(params.webSocketSlots.take).not.toHaveBeenCalled();
  });

  it('passes an error on to express', async () => {
    const error = new Error('failed');
    const { handler, next } = setup({ acquireLease: jest.fn(() => Promise.reject(error)) });

    await handler(request(), response, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
