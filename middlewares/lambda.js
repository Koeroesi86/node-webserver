const { resolve } = require('path');
const rimraf = require('rimraf');
const { httpMiddleware } = require('@koeroesi86/node-lambda-invoke');
const logger = require('../utils/logger');

const lambdaMiddleware = (instance) => {
  const { lambdaOptions: config } = instance;
  const storageDriver = resolve(__dirname, '../utils/storage').replace(/\\/g, '/');
  const lambdaToInvoke = (config.lambda || '').replace(/\\/g, '/');
  const handlerKey = config.handler || 'handler';

  rimraf.sync(resolve(__dirname, '../requests/*'));
  rimraf.sync(resolve(__dirname, '../responses/*'));

  return httpMiddleware(lambdaToInvoke, handlerKey, logger.info, storageDriver);
};

module.exports = lambdaMiddleware;
