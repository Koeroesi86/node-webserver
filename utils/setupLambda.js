const url = require('url');
const { resolve, dirname } = require('path');
const { fork } = require('child_process');
const vHost = require('vhost');
const setupChildListener = require('./setupChildListener');
const getDate = require('./getDate');
const logger = require('./logger');

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

module.exports = ({ server, hostname = 'localhost', config = {}, instance }) => {
  if (config.lambda) server.use(vHost(hostname, (request, response) => {
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
      const invoke = resolve(__dirname, './invokeLambda.js').replace(/\\/, '/');
      const lambdaToInvoke = (config.lambda || '').replace(/\\/g, '/');
      const handlerKey = config.handler || 'handler';

      logger.system(`[${getDate()}] Invoking lambda`, `${lambdaToInvoke}#${handlerKey}`);
      if (!instance.lambdas) {
        instance.lambdas = {};
      }

      // Reuse forked instance
      const lambdaIds = Object.keys(instance.lambdas);
      if (lambdaIds.length> 0) {
        // Sort in descending by created
        const lambdaId = lambdaIds.sort((a, b) => instance.lambdas[b].created - instance.lambdas[a].created)[0];
        lambdaInstance = instance.lambdas[lambdaId];
      } else {
        lambdaInstance = fork(
          invoke,
          [
            '--lambda', lambdaToInvoke,
            '--handler', handlerKey
          ],
          {
            silent: true,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            cwd: dirname(lambdaToInvoke)
          }
        );
        // add created for later use
        lambdaInstance.created = Date.now();

        instance.lambdas[lambdaInstance.pid] = lambdaInstance;
      }

      setupChildListener(lambdaInstance);

      lambdaInstance.send(event);

      /** @var {ResponseEvent} responseEvent */
      const messageListener = responseEvent => {
        if (responseEvent.statusCode) {
          response.writeHead(responseEvent.statusCode, responseEvent.headers);
          if (responseEvent.body) {
            const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
            response.end(Buffer.from(responseEvent.body, bufferEncoding));
          }
        }
      };
      lambdaInstance.on('message', messageListener);

      const closeListener = () => {
        response.end();
        lambdaInstance.off('message', messageListener);
        lambdaInstance.off('close', closeListener);
        instance.lambdas[lambdaInstance.pid] = null;
        delete instance.lambdas[lambdaInstance.pid];
      };
      lambdaInstance.on('close', closeListener);
    } catch (e) {
      logger.error(e);
      response.writeHead(500);
      response.write('Something went wrong');
      response.end();
    }
  }));
};
