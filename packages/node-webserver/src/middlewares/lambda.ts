import type { RequestHandler } from 'express';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import logger from '../utils/logger';
import type { ServerInstance } from '../types';

const lambdaMiddleware = (instance: ServerInstance): RequestHandler => {
  const { lambdaOptions: config } = instance;

  return httpMiddleware({
    lambdaPath: (config?.lambda || '').replace(/\\/g, '/'),
    handlerKey: config?.handler || 'handler',
    logger: logger.info,
    communication: { type: config?.communication || 'ipc' },
    limit: config?.limit,
    acquireTimeout: config?.acquireTimeout,
    startTimeout: config?.startTimeout,
    timeout: config?.timeout,
    limitRequestBody: config?.limitRequestBody,
    restrictFileSystem: config?.restrictFileSystem,
    env: config?.env,
  });
};

export default lambdaMiddleware;
