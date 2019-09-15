const { resolve, join } = require('path');
const { existsSync } = require('fs');
const { Worker } = require('@koeroesi86/node-lambda-invoke');
const url = require('url');
const send = require('send');
const logger = require('../utils/logger');
const getDate = require('../utils/getDate');

const workers = {};

const FORBIDDEN_PATHS = [
  '..'
];

/**
 * @param {string} path
 * @returns {Promise<Worker>}
 */
function getWorker(path, options = {}) {// TODO: worker pool
  if (workers[path]) {
    return Promise.resolve(workers[path]);
  }

  const worker = new Worker(path, options);
  worker.createdAt = Date.now();
  workers[path] = worker;

  worker.addEventListenerOnce('close', () => {
    delete workers[path];
  });

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

    // todo: limit request size

    let isIndex = false;
    const pathFragments = path.split(/\//gi).filter(Boolean);
    let currentPathFragments = pathFragments.slice();

    if (currentPathFragments.find(p => FORBIDDEN_PATHS.includes(p))) return next();

    let pathExists = false;
    for (let i = currentPathFragments.length; i >= 0; i--) {
      if (!pathExists) {
        currentPathFragments.splice(i);
        pathExists = existsSync(join(rootPath, ...currentPathFragments));
        break;
      }
    }

    let indexPath = join(rootPath, ...currentPathFragments);

    if (currentPathFragments.length < pathFragments.length) {
      config.index.find(indexFile => {
        const checkIndexFilePath = join(rootPath, ...currentPathFragments, indexFile);
        if (existsSync(checkIndexFilePath)) {
          isIndex = true;
          indexPath = checkIndexFilePath;
          return true;
        }
      });
    } else if (config.index.find(indexFile => {
      const checkIndexFilePath = resolve(indexPath, indexFile);

      if (existsSync(checkIndexFilePath)) {
        indexPath = checkIndexFilePath;
        isIndex = true;
        return true;
      }
    })) { // detect index for trailing slash

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
      event.pathFragments = pathFragments;
      event.queryStringParameters = queryStringParameters;
      event.headers = request.headers;
      if (request.body) event.body = JSON.stringify(request.body);

      logger.info(`[${getDate()}] Invoking worker`, indexPath);

      Promise.resolve()
        .then(() => getWorker(indexPath, config.options))
        .then(worker => {
          worker.addEventListenerOnce('message', responseEvent => {
            response.writeHead(responseEvent.statusCode, responseEvent.headers);
            const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
            response.end(Buffer.from(responseEvent.body, bufferEncoding));
          });
          worker.postMessage(event);
        });
    } else if (['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      const stream = send(request, path, {
        maxage: 0,
        root: rootPath,
      });
      stream.on('error', err => {
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
