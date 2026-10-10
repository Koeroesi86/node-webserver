import { basename, dirname, extname } from 'path';
import { ALLOWED_ENV, ENV_COMMUNICATION, ENV_HANDLER, ENV_PATH } from '../constants';
import type { Communication } from '../types';

/**
 * The environment of a lambda process: the allowed variables of the server, the ones AWS sets for a function, then the ones of the options.
 * The variables of the runtime come last, so that nothing can replace them.
 */
const createLambdaEnvironment = (lambdaPath: string, handlerKey: string, communication: Communication, env: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const functionName = basename(lambdaPath, extname(lambdaPath));

  return {
    ...Object.fromEntries(ALLOWED_ENV.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])),
    AWS_LAMBDA_FUNCTION_NAME: functionName,
    AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
    LAMBDA_TASK_ROOT: dirname(lambdaPath),
    _HANDLER: `${functionName}.${handlerKey}`,
    ...env,
    [ENV_PATH]: lambdaPath,
    [ENV_HANDLER]: handlerKey,
    [ENV_COMMUNICATION]: JSON.stringify(communication),
  };
};

export default createLambdaEnvironment;
