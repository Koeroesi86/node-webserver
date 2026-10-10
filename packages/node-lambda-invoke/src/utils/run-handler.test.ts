import RequestEvent from '../classes/RequestEvent';
import createContext from './create-context';
import runHandler from './run-handler';
import type { LambdaHandler } from '../types';

const run = (handler: LambdaHandler, thisArg?: unknown) =>
  runHandler({ handler, thisArg }, new RequestEvent(), (done) => createContext('request-1', Date.now() + 1000, done, {}));

describe('runHandler', () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('answers with what the callback is given', async () => {
    const response = await run((event, context, callback) => callback(null, { statusCode: 200, body: 'ok' }));

    expect(response).toMatchObject({ statusCode: 200, body: 'ok' });
  });

  it('answers with what an async handler returns', async () => {
    const response = await run(async () => ({ statusCode: 201 }));

    expect(response).toMatchObject({ statusCode: 201 });
  });

  it('answers with the first of the promise and the callback to settle', async () => {
    const callbackFirst = await run((event, context, callback) => {
      callback(null, { statusCode: 200 });
      return Promise.resolve({ statusCode: 500 });
    });
    const promiseFirst = await run((event, context, callback) => {
      setTimeout(() => callback(null, { statusCode: 500 }), 10);
      return Promise.resolve({ statusCode: 200 });
    });

    expect([callbackFirst.statusCode, promiseFirst.statusCode]).toEqual([200, 200]);
  });

  it('answers 502 with a generic body, and logs the error, when the handler fails in any way', async () => {
    const failures = await Promise.all([
      run((event, context, callback) => callback(new Error('secret'))),
      run(() => {
        throw new Error('secret');
      }),
      run(async () => {
        throw new Error('secret');
      }),
      run(() => Promise.reject(undefined)),
    ]);

    failures.forEach((response) => expect(response).toMatchObject({ statusCode: 502, body: '{"message":"Internal server error"}' }));
    expect(error).toHaveBeenCalledTimes(4);
  });

  it('has no status code, which makes it malformed, for a result that is not a response', async () => {
    const results = await Promise.all([
      run(async () => undefined),
      run(async () => 'text'),
      run(async () => null),
      run((event, context, callback) => callback(null)),
    ]);

    results.forEach((response) => expect(response.statusCode).toBeUndefined());
  });

  it('calls the handler on what holds it, with the context', async () => {
    const holder = {
      id: 'holder',
      handler(this: { id: string }, event: RequestEvent, context: { awsRequestId: string }) {
        return Promise.resolve({ statusCode: 200, body: `${this.id} ${context.awsRequestId}` });
      },
    };

    const response = await run(holder.handler, holder);

    expect(response.body).toBe('holder request-1');
  });
});
