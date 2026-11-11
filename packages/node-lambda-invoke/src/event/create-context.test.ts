import createContext from './create-context';

describe('createContext', () => {
  const env = { AWS_LAMBDA_FUNCTION_NAME: 'api', AWS_REGION: 'eu-west-1', AWS_LAMBDA_LOG_GROUP_NAME: '/aws/lambda/api' };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tells the function about itself and the invocation', () => {
    const context = createContext('request-1', Date.now() + 1000, jest.fn(), env);

    expect(context).toMatchObject({
      awsRequestId: 'request-1',
      functionName: 'api',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:eu-west-1:000000000000:function:api',
      memoryLimitInMB: '128',
      logGroupName: '/aws/lambda/api',
      callbackWaitsForEmptyEventLoop: true,
    });
  });

  it('counts the time that is left down to zero', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const context = createContext('request-1', 1_000_000 + 5000, jest.fn(), env);

    expect(context.getRemainingTimeInMillis()).toBe(5000);

    jest.advanceTimersByTime(4000);

    expect(context.getRemainingTimeInMillis()).toBe(1000);

    jest.advanceTimersByTime(9000);

    expect(context.getRemainingTimeInMillis()).toBe(0);
  });

  it('answers through the callbacks of the old runtimes as well', () => {
    const done = jest.fn();
    const context = createContext('request-1', Date.now(), done, env);
    const error = new Error('no');

    context.succeed({ statusCode: 200 });
    context.fail(error);
    context.done(null, { statusCode: 201 });

    expect(done.mock.calls).toEqual([[null, { statusCode: 200 }], [error], [null, { statusCode: 201 }]]);
  });
});
