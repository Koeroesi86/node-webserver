import createLambdaEnvironment from './create-lambda-environment';

describe('createLambdaEnvironment', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('passes only the allowed variables of the server', () => {
    process.env = { PATH: '/bin', SECRET_OF_THE_SERVER: 'secret' };

    const env = createLambdaEnvironment('/lambdas/api.js', 'handler', { type: 'ipc' });

    expect(env.PATH).toBe('/bin');
    expect(env).not.toHaveProperty('SECRET_OF_THE_SERVER');
  });

  it('sets the variables AWS sets for a function', () => {
    const env = createLambdaEnvironment('/lambdas/api.js', 'main', { type: 'ipc' });

    expect(env).toMatchObject({ AWS_LAMBDA_FUNCTION_NAME: 'api', AWS_LAMBDA_FUNCTION_VERSION: '$LATEST', LAMBDA_TASK_ROOT: '/lambdas', _HANDLER: 'api.main' });
  });

  it('adds the variables of the options, which can replace the others', () => {
    process.env = { TZ: 'Europe/Budapest' };

    const env = createLambdaEnvironment('/lambdas/api.js', 'handler', { type: 'ipc' }, { TZ: 'UTC', TABLE: 'users' });

    expect(env).toMatchObject({ TZ: 'UTC', TABLE: 'users' });
  });

  it('keeps its own variables apart from the ones of the lambda', () => {
    const env = createLambdaEnvironment('/lambdas/api.js', 'main', { type: 'file' }, { NODE_LAMBDA_PATH: '/other.js', LAMBDA: 'mine', HANDLER: 'mine' });

    expect(env).toMatchObject({
      NODE_LAMBDA_PATH: '/lambdas/api.js',
      NODE_LAMBDA_HANDLER: 'main',
      NODE_LAMBDA_COMMUNICATION: '{"type":"file"}',
      LAMBDA: 'mine',
      HANDLER: 'mine',
    });
  });
});
