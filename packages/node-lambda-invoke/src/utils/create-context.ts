import { DEFAULT_TIMEOUT } from '../constants';
import type { LambdaCallback, LambdaContext } from '../types';

/** the context of an invocation, with what the runtime of AWS tells a function about itself */
const createContext = (requestId: string, deadline: number, done: LambdaCallback, env: NodeJS.ProcessEnv = process.env): LambdaContext => {
  const { AWS_LAMBDA_FUNCTION_NAME = '', AWS_LAMBDA_FUNCTION_VERSION = '$LATEST', AWS_REGION = 'us-east-1' } = env;
  const { AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '128', AWS_LAMBDA_LOG_GROUP_NAME = '', AWS_LAMBDA_LOG_STREAM_NAME = '' } = env;

  return {
    // the answer is given on the callback, the event loop is not waited for
    callbackWaitsForEmptyEventLoop: true,
    functionName: AWS_LAMBDA_FUNCTION_NAME,
    functionVersion: AWS_LAMBDA_FUNCTION_VERSION,
    invokedFunctionArn: `arn:aws:lambda:${AWS_REGION}:000000000000:function:${AWS_LAMBDA_FUNCTION_NAME}`,
    memoryLimitInMB: AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
    awsRequestId: requestId,
    logGroupName: AWS_LAMBDA_LOG_GROUP_NAME,
    logStreamName: AWS_LAMBDA_LOG_STREAM_NAME,
    getRemainingTimeInMillis: () => Math.max(0, (Number.isFinite(deadline) ? deadline : Date.now() + DEFAULT_TIMEOUT) - Date.now()),
    done,
    succeed: (response) => done(null, response),
    fail: (error) => done(error ?? new Error('The function failed.')),
  };
};

export default createContext;
