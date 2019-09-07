const { resolve } = require('path');
const { existsSync } = require('fs');
const { Worker } = require('@koeroesi86/node-lambda-invoke');
const url = require('url');
const send = require('send');
const logger = require('../utils/logger');

const workers = {};

/**
 * @param {string} path
 * @returns {Worker}
 */
function getWorker(path) {// TODO: worker pool
  if (workers[path]) {
    return workers[path];
  }

  const worker = new Worker(path);
  worker.createdAt = Date.now();
  workers[path] = worker;

  setTimeout(() => { // make worker auto close after an hour
    worker.terminate();
    delete workers[path];
  }, 60 * 60 * 1000);

  return worker;
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
        if (path.indexOf(indexFile) === path.length - 1) {
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

      logger.info('Invoking worker', indexPath);

      const worker = getWorker(indexPath);
      worker.addEventListenerOnce('message', responseEvent => {
        const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
        response.end(Buffer.from(responseEvent.body, bufferEncoding));
      });
      worker.postMessage(event);
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
