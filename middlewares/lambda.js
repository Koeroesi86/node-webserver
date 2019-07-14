const url = require('url');
const { resolve, dirname } = require('path');
// const { mkdirSync } = require('fs');
const { fork } = require('child_process');
const setupChildListener = require('../utils/setupChildListener');
const getDate = require('../utils/getDate');
const logger = require('../utils/logger');

/**
 * @typedef RequestEvent
 * @property {String} path
 * @property {Object.<String, String>} headers
 * @property {Object.<String, String>} [pathParameters]
 * @property {Object} [requestContext]
 * @property {String} [resource]
 * @property {String} httpMethod
 * @property {Object.<String, String>} queryStringParameters
 * @property {Object.<String, String>} [stageVariables]
 */

/**
 * @typedef ResponseEvent
 * @property {Number} statusCode
 * @property {Object.<String, String>} headers
 * @property {String} body
 */

const lambdaMiddleware = (instance) => {
  const { lambdaOptions: config } = instance;
  return (request, response) => {
    const {
      query: queryStringParameters,
      pathname: path,
    } = url.parse(request.url, true);

    /** @var {RequestEvent} event */
    const event = {
      httpMethod: request.method.toUpperCase(),
      headers: request.headers,
      path,
      queryStringParameters
    };
    let lambdaInstance;

    try {
      const invoke = resolve(__dirname, '../utils/invokeLambda.js').replace(/\\/, '/');
      const lambdaToInvoke = (config.lambda || '').replace(/\\/g, '/');
      const handlerKey = config.handler || 'handler';

      logger.system(`[${getDate()}] Invoking lambda`, `${lambdaToInvoke}#${handlerKey}`);
      if (!instance.lambdas) {
        instance.lambdas = {};
      }

      // Reuse forked instance
      const lambdaIds = Object.keys(instance.lambdas).reverse();
      if (lambdaIds.length > 0) {
        // Sort in descending by created
        // const lambdaIds = lambdaIds.sort((a, b) => instance.lambdas[b].created - instance.lambdas[a].created);
        const firstNonBusyId = lambdaIds.find(id => !instance.lambdas[id].busy);
        lambdaInstance = instance.lambdas[firstNonBusyId];
      } else {
        // const tmpPath = resolve(__dirname, `../tmp/${uuid.v4()}`).replace(/\\/g, '/');
        // mkdirSync(tmpPath);
        lambdaInstance = fork(
          invoke,
          [
            '--lambda', lambdaToInvoke,
            '--handler', handlerKey,
            // '--tmp', tmpPath
          ],
          {
            // silent: true,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            cwd: dirname(lambdaToInvoke),
            env: {
              // TEMP: tmpPath,
              // TMP: tmpPath,
              PWD: dirname(lambdaToInvoke).replace(/\\/g, '/'),
            }
          }
        );
        const closeListener = () => {
          // rimraf(tmpPath);
          lambdaInstance.off('close', closeListener);
          delete instance.lambdas[lambdaInstance.pid];
        };
        lambdaInstance.on('close', closeListener);

        // add created for later use
        lambdaInstance.created = Date.now();

        instance.lambdas[lambdaInstance.pid] = lambdaInstance;
      }

      setupChildListener(lambdaInstance);

      lambdaInstance.busy = true;
      lambdaInstance.send(event);

      /** @var {ResponseEvent} responseEvent */
      const messageListener = responseEvent => {
        lambdaInstance.busy = false;
        if (responseEvent.statusCode) {
          response.writeHead(responseEvent.statusCode, responseEvent.headers);
          if (responseEvent.body) {
            const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
            response.end(Buffer.from(responseEvent.body, bufferEncoding));
          }
        }
      };

      lambdaInstance.on('message', messageListener);
      lambdaInstance.on('close', () => {
        response.end();
        lambdaInstance.off('message', messageListener);
      });
    } catch (e) {
      logger.error(e);
      response.writeHead(500);
      response.write('Something went wrong');
      response.end();
    }
  };
};

module.exports = lambdaMiddleware;
