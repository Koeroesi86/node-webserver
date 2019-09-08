const { resolve } = require('path');
const { existsSync } = require('fs');
const { Worker } = require('@koeroesi86/node-lambda-invoke');
const url = require('url');
const send = require('send');
const logger = require('../utils/logger');
const getDate = require('../utils/getDate');

const workers = {};

const WORKER_EXPIRY = 60 * 60 * 1000;

/**
 * @param {string} path
 * @returns {Promise<Worker>}
 */
function getWorker(path) {// TODO: worker pool
  if (workers[path]) {
    return Promise.resolve(workers[path]);
  }

  const worker = new Worker(path);
  worker.createdAt = Date.now();
  workers[path] = worker;

  setTimeout(() => {
    worker.terminate();
    delete workers[path];
  }, WORKER_EXPIRY);

  return Promise.resolve(worker);
}

const workerMiddleware = (instance) => {
  const { workerOptions: config } = instance;
  const rootPath = resolve(config.root);

  return (request, response, next) => {
    const {
      query: queryStringParameters,
      pathname: path
    } = url.parse(request.url, true);

    let isIndex = false;
    let indexPath = resolve(rootPath, `.${path}`);

    // TODO: attempt to fallback to parent index on 404

    // detect index for trailing slash
    if (path.lastIndexOf('/') === path.length - 1) {
      config.index.find(indexFile => {
        const checkIndexFilePath = resolve(indexPath, indexFile);

        if (existsSync(checkIndexFilePath)) {
          indexPath = checkIndexFilePath;
          isIndex = true;
          return true;
        }
      });
    } else {
      config.index.find(indexFile => {
        if (path.indexOf(indexFile) === path.length - indexFile.length) {
          isIndex = true;
          return true;
        }
      });
    }

    if (isIndex) {
      /** @var {RequestEvent} event */
      const event = {};
      event.httpMethod = request.method.toUpperCase();
      event.path = path;
      event.queryStringParameters = queryStringParameters;
      event.headers = request.headers;

      logger.info(`[${getDate()}] Invoking worker`, indexPath);

      Promise.resolve()
        .then(() => getWorker(indexPath))
        .then(worker => {
          worker.addEventListenerOnce('message', responseEvent => {
            const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
            response.end(Buffer.from(responseEvent.body, bufferEncoding));
          });
          worker.postMessage(event);
        });
    } else {
      const stream = send(request, path, {
        maxage: 0,
        root: rootPath,
      });
      stream.on('error', function error (err) {
        if (!(err.statusCode < 500)) {
          next(err);
          return;
        }

        next();
      });

      stream.pipe(response);
    }
  };
};

module.exports = workerMiddleware;
