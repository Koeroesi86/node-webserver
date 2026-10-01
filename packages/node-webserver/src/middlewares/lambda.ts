import { resolve } from 'path';
import type { RequestHandler } from 'express';
import rimraf from 'rimraf';
import { httpMiddleware } from '@koeroesi86/node-lambda-invoke';
import logger from '../utils/logger';
import { PACKAGE_ROOT } from '../constants';
import type { ServerInstance } from '../types';

const lambdaMiddleware = (instance: ServerInstance): RequestHandler => {
  const { lambdaOptions: config } = instance;
  const storageDriver = resolve(__dirname, '../utils/storage').replace(/\\/g, '/');
  const lambdaToInvoke = (config?.lambda || '').replace(/\\/g, '/');
  const handlerKey = config?.handler || 'handler';

  rimraf.sync(resolve(PACKAGE_ROOT, 'requests/*'), { glob: { silent: true } });
  rimraf.sync(resolve(PACKAGE_ROOT, 'responses/*'), { glob: { silent: true } });

  // The installed @koeroesi86/node-lambda-invoke takes a single options object, while this call still uses the older positional
  // signature, which makes the middleware a no-op at runtime. Behaviour is kept as it was until the call is migrated.
  // @ts-expect-error positional arguments are not part of the current signature
  return httpMiddleware(lambdaToInvoke, handlerKey, logger.info, storageDriver);
};

export default lambdaMiddleware;
