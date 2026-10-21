import type { IncomingMessage } from 'http';
import { PassThrough } from 'stream';
import { WORKER_EVENT } from '@koeroesi86/node-worker/pool';
import type { RequestEvent, WorkerLease, WorkerOutputEvent } from '@koeroesi86/node-worker/pool';
import invokeLambda from './invoke-lambda';

const event = (fields: Partial<RequestEvent> = {}): RequestEvent => ({
  httpMethod: 'POST',
  protocol: 'HTTP',
  path: '/',
  pathFragments: [],
  queryStringParameters: {},
  headers: {},
  remoteAddress: '',
  rootPath: '',
  ...fields,
});

const setup = (eventFields: Partial<RequestEvent> = {}, params: { timeout?: number; limitRequestBody?: number } = {}) => {
  const request = new PassThrough();
  const subscription: { onMessage?: (message: WorkerOutputEvent) => void; onExit?: (code: number | null) => void } = {};
  const send = jest.fn();
  const lease = {
    send,
    subscribe: jest.fn((_requestId: string, onMessage: (message: WorkerOutputEvent) => void, onExit: (code: number | null) => void) =>
      Object.assign(subscription, { onMessage, onExit })
    ),
  } as unknown as WorkerLease;
  const outcome = invokeLambda({
    lease,
    request: request as unknown as IncomingMessage,
    requestId: 'r1',
    event: event(eventFields),
    timeout: params.timeout ?? 60000,
    limitRequestBody: params.limitRequestBody ?? 0,
  });

  return { request, subscription, send, outcome };
};

const types = (send: jest.Mock) => send.mock.calls.map(([message]) => message.type);

describe('invokeLambda', () => {
  afterEach(() => jest.useRealTimers());

  it('sends the request, and settles with the response of the worker', async () => {
    const { subscription, send, outcome } = setup();

    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event: expect.objectContaining({ path: '/' }) });

    subscription.onMessage?.({ type: WORKER_EVENT.RESPONSE, requestId: 'r1', event: { statusCode: 200, body: Buffer.from('ok') } });

    expect(await outcome).toEqual({ type: 'response', response: { statusCode: 200, body: Buffer.from('ok') } });
  });

  it('streams the body to the worker, and ends it', async () => {
    const { request, send, subscription, outcome } = setup({ hasBody: true });

    request.write('ab');
    request.end('cd');
    await new Promise((resolve) => request.once('end', resolve));
    subscription.onMessage?.({ type: WORKER_EVENT.RESPONSE, requestId: 'r1', event: { statusCode: 200 } });
    await outcome;

    expect(send.mock.calls.slice(1).map(([message]) => message.event?.body ?? null)).toEqual([Buffer.from('ab'), Buffer.from('cd'), null]);
  });

  it('does not touch the body of a request without one', async () => {
    const { request, subscription, outcome } = setup();

    subscription.onMessage?.({ type: WORKER_EVENT.RESPONSE, requestId: 'r1', event: { statusCode: 200 } });
    await outcome;

    expect(request.listenerCount('data')).toBe(0);
  });

  it('settles with the exit of the worker', async () => {
    const { subscription, outcome } = setup();

    subscription.onExit?.(1);

    expect(await outcome).toEqual({ type: 'closed' });
  });

  it('settles with a timeout when the worker does not answer in time', async () => {
    jest.useFakeTimers();
    const { outcome } = setup({}, { timeout: 500 });

    jest.advanceTimersByTime(500);

    expect(await outcome).toEqual({ type: 'timeout' });
  });

  it('settles with a body that is too large, and tells the worker to stop reading it', async () => {
    const { request, send, outcome } = setup({ hasBody: true }, { limitRequestBody: 3 });

    request.write('abcd');

    expect(await outcome).toEqual({ type: 'tooLarge' });
    expect(types(send)).toContain(WORKER_EVENT.REQUEST_ABORT);
    expect(request.listenerCount('data')).toBe(0);
  });

  it('settles as abandoned when the client goes away before the whole body arrived, and tells the worker', async () => {
    const { request, send, outcome } = setup({ hasBody: true });

    request.write('ab');
    request.emit('close');

    expect(await outcome).toEqual({ type: 'abandoned' });
    expect(types(send)).toContain(WORKER_EVENT.REQUEST_ABORT);
  });

  it('does not mind a client that goes away after the whole body arrived, the lambda answers anyway', async () => {
    const { request, send, subscription, outcome } = setup({ hasBody: true });

    request.end('ab');
    await new Promise((resolve) => request.once('end', resolve));
    request.emit('close');
    subscription.onMessage?.({ type: WORKER_EVENT.RESPONSE, requestId: 'r1', event: { statusCode: 200 } });

    expect(await outcome).toMatchObject({ type: 'response' });
    expect(types(send)).not.toContain(WORKER_EVENT.REQUEST_ABORT);
  });

  it('lets the upload go on at the pace of the worker', async () => {
    const { request, subscription, outcome } = setup({ hasBody: true });
    const pause = jest.spyOn(request, 'pause');
    const resume = jest.spyOn(request, 'resume');

    // the worker has taken none of the parts, so the upload waits
    Array.from({ length: 4 }).forEach(() => request.emit('data', Buffer.from('x')));
    expect(pause).toHaveBeenCalled();

    subscription.onMessage?.({ type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId: 'r1' });
    expect(resume).toHaveBeenCalled();

    subscription.onMessage?.({ type: WORKER_EVENT.RESPONSE, requestId: 'r1', event: { statusCode: 200 } });
    await outcome;
  });
});
