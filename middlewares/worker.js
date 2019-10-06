const { resolve, join } = require('path');
const { existsSync } = require('fs');
const { Worker } = require('@koeroesi86/node-lambda-invoke');
const url = require('url');
const send = require('send');
const logger = require('../utils/logger');
const getDate = require('../utils/getDate');
const WorkerPool = require('../utils/workerPool');

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
  const workerPool = new WorkerPool({ overallLimit: config.limit, logger: console.log });

  return (request, response, next) => {
    const {
      query: queryStringParameters,
      pathname: path
    } = url.parse(request.url, true);

    // todo: limit request size

    Promise.resolve()
      .then(() => new Promise((res, rej) => {
        let body = '';
        request.on('data', data => {
          body += data;

          // Too much POST data, kill the connection!
          // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
          if (body.length > (config.limitRequestBody || 1000000)) {
            body = "";
            response.writeHead(413, { 'Content-Type': 'text/plain' });
            response.end();
            request.connection.destroy();
            rej();
          }
        });
        request.on('end', () => {
          request.body = body;
          res();
        });
      }))
      .then(() => {
        let isIndex = false;
        const pathFragments = path.split(/\//gi).filter(Boolean);
        let currentPathFragments = pathFragments.slice();

        if (currentPathFragments.find(p => FORBIDDEN_PATHS.includes(p))) return next();

        let pathExists = false;
        for (let i = currentPathFragments.length; i >= 0; i--) {
          if (!pathExists) {
            currentPathFragments.splice(i);
            pathExists = existsSync(join(rootPath, ...currentPathFragments));
          }
        }

        let indexPath = join(rootPath, ...currentPathFragments);

        if (currentPathFragments.length < pathFragments.length) {
          let indexFound = false;
          for (let i = currentPathFragments.length; i >= 0; i--) {
            if (!indexFound) {
              currentPathFragments.splice(i);
              indexFound = !!config.index.find(indexFile => {
                const checkIndexFilePath = join(rootPath, ...currentPathFragments, indexFile);
                if (existsSync(checkIndexFilePath)) {
                  isIndex = true;
                  indexPath = checkIndexFilePath;
                  return true;
                }
              });
            }
          }
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
          event.body = request.body;

          logger.info(`[${getDate()}] Invoking worker`, indexPath);

          Promise.resolve()
            .then(() => workerPool.getWorker(`${resolve(__dirname, './workerInvoke.js')} ${indexPath.replace(/\\/gi, '/')}`, config.options, config.limitPerPath))
            .then(worker => {
              worker.busy = true;
              worker.addEventListenerOnce('message', responseEvent => {
                response.writeHead(responseEvent.statusCode, responseEvent.headers);
                const bufferEncoding = responseEvent.isBase64Encoded ? 'base64' : 'utf8';
                response.end(Buffer.from(responseEvent.body, bufferEncoding));
                worker.busy = false;
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
      });
  };
};

module.exports = workerMiddleware;
