const url = require('url');
const { resolve } = require('path');
const { fork } = require('child_process');
const vHost = require('vhost');
const setupChildListener = require('./setupChildListener');
const getDate = require('./getDate');

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
    if (request.hostname === hostname) {
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

        console.log(`[${getDate()}] Invoking lambda`, `${lambdaToInvoke}#${handlerKey}`);
        lambdaInstance = fork(
          invoke,
          [
            '--lambda', lambdaToInvoke,
            '--handler', handlerKey
          ],
          {
            silent: true,
          }
        );

        if (instance) {
          if (!instance.lambdas) {
            instance.lambdas = {};
          }
          instance.lambdas[lambdaInstance.pid] = lambdaInstance;
        }

        setupChildListener(lambdaInstance);

        let killTimer;
        const setKillTimer = () => {
          killTimer = setTimeout(() => {
            lambdaInstance.kill('SIGINT');
          }, 15 * 60 * 1000); // setting to default AWS timeout
        };

        lambdaInstance.send(event);

        setKillTimer();

        /** @var {ResponseEvent} responseEvent */
        lambdaInstance.on('message', responseEvent => {
          if (responseEvent.statusCode) {
            clearTimeout(killTimer);
            response.writeHead(responseEvent.statusCode, responseEvent.headers);
            if (responseEvent.body) {
              if (responseEvent.headers['Content-Type'] && !/text\//.test(responseEvent.headers['Content-Type'])) {
                response.end(responseEvent.body, 'binary');
              } else {
                response.write(responseEvent.body);
              }
            }

            lambdaInstance.kill('SIGINT');
          }
        });

        lambdaInstance.on('close', () => {
          clearTimeout(killTimer);
          response.end();
          instance.lambdas[lambdaInstance.pid] = null;
          delete instance.lambdas[lambdaInstance.pid];
        });
      } catch (e) {
        console.error(e);
        response.writeHead(500);
        response.write('Something went wrong');
        response.end();
        lambdaInstance.kill('SIGINT');
      }
    }
  }));
};
