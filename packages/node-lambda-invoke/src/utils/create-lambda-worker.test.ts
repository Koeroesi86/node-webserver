import { Readable } from 'stream';
import type { ResponseCallback, WorkerRequestEvent } from '@koeroesi86/node-worker-pool';
import createLambdaWorker from './create-lambda-worker';

const workerEvent = (bodyStream: Readable, fields: Partial<WorkerRequestEvent> = {}): WorkerRequestEvent => ({
  httpMethod: 'POST',
  protocol: 'HTTP',
  path: '/orders',
  pathFragments: [],
  queryStringParameters: { a: ['1', '2'] },
  headers: { host: 'example.test' },
  rawHeaders: ['Host', 'example.test'],
  httpVersion: '1.1',
  remoteAddress: '10.0.0.1',
  rootPath: '',
  requestId: 'request-1',
  getMetrics: jest.fn(),
  bodyStream,
  ...fields,
});

describe('createLambdaWorker', () => {
  it('calls the handler with the event of API Gateway and the body, and answers with its response', async () => {
    const handler = jest.fn(async (_event: unknown, _context: unknown) => ({ statusCode: 201, headers: { 'x-a': '1' }, body: 'created' }));
    const callback: ResponseCallback = jest.fn();

    await createLambdaWorker({ handler, thisArg: undefined })(workerEvent(Readable.from([Buffer.from('he'), Buffer.from('llo')])), callback);

    const [event, context] = handler.mock.calls[0];
    expect(event).toMatchObject({
      path: '/orders',
      httpMethod: 'POST',
      body: 'hello',
      multiValueQueryStringParameters: { a: ['1', '2'] },
      requestContext: { requestId: 'request-1' },
    });
    expect(context).toMatchObject({ awsRequestId: 'request-1' });
    expect(callback).toHaveBeenCalledWith({ statusCode: 201, headers: { 'x-a': '1' }, body: Buffer.from('created') });
  });

  it('gives the handler the time that is left until the deadline of the request', async () => {
    let remaining = 0;
    const handler = jest.fn(async (_event, context) => {
      remaining = context.getRemainingTimeInMillis();
      return { statusCode: 200 };
    });

    await createLambdaWorker({ handler, thisArg: undefined })(workerEvent(Readable.from([]), { deadline: Date.now() + 60000 }), jest.fn());

    expect(remaining).toBeGreaterThan(50000);
    expect(remaining).toBeLessThanOrEqual(60000);
  });

  it('answers 502 without the details when the handler fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const callback: ResponseCallback = jest.fn();

    await createLambdaWorker({ handler: () => Promise.reject(new Error('the secret of the handler')), thisArg: undefined })(
      workerEvent(Readable.from([])),
      callback
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 502, body: Buffer.from('{"message":"Internal server error"}') }));
    error.mockRestore();
  });

  it('neither calls the handler nor answers a request that was aborted while its body came in', async () => {
    const handler = jest.fn();
    const callback: ResponseCallback = jest.fn();
    const body = new Readable({ read() {} });
    const done = createLambdaWorker({ handler, thisArg: undefined })(workerEvent(body), callback);

    body.destroy(new Error('The request was aborted.'));
    await done;

    expect(handler).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});
