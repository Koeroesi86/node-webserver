const uuid = require('uuid/v4');
const path = require('path');
const { existsSync } = require('fs');
const url = require('url');
const os = require('os');
const { WORKER_EVENT } = require('../constants');
const logger = require('../utils/logger');
const getDate = require('../utils/getDate');
const WorkerPool = require('../utils/workerPool');

const FORBIDDEN_PATHS = [
  '..'
];

const PROTOCOLS = {
  HTTP: 'HTTP',
  WEBSOCKET: 'WS',
};

const isWebSocket = request => {
  if (request.method !== 'GET') return false;

  const connection = request.headers.connection || '';
  const upgrade = request.headers.upgrade || '';

  return request.method === 'GET' &&
    connection.toLowerCase().split(/ *, */).indexOf('upgrade') >= 0 &&
    upgrade.toLowerCase() === 'websocket';
};

/**
 * TODO: improve
 * @param {Buffer} data
 * @returns {string}
 */
const parseWsMessage = data => {
  const dl = data[1] & 127;
  let ifm = 2;
  if (dl === 126) {
    ifm = 4;
  } else if (dl === 127) {
    ifm = 10;
  }
  let i = ifm + 4;
  const masks = data.slice(ifm, i);
  let index = 0;
  let output = "";
  const l = data.length;
  while (i < l) {
    output += String.fromCharCode(data[i++] ^ masks[index++ % 4]);
  }
  return output;
};

/**
 * TODO: improve
 * @param {String} text
 * @returns {Buffer}
 */
const constructWsMessage = text => {
  const jsonByteLength = Buffer.byteLength(text);
  // Note: we're not supporting > 65535 byte payloads at this stage
  const lengthByteCount = jsonByteLength < 126 ? 0 : 2;
  const payloadLength = lengthByteCount === 0 ? jsonByteLength : 126;
  const buffer = Buffer.alloc(2 + lengthByteCount + jsonByteLength);
  // Write out the first byte, using opcode `1` to indicate that the message
  // payload contains text data
  buffer.writeUInt8(0b10000001, 0);
  buffer.writeUInt8(payloadLength, 1);
  // Write the length of the JSON payload to the second byte
  let payloadOffset = 2;
  if (lengthByteCount > 0) {
    buffer.writeUInt16BE(jsonByteLength, 2); payloadOffset += lengthByteCount;
  }
  // Write the JSON data to the data buffer
  buffer.write(text, payloadOffset);
  return buffer;
};

const workerMiddleware = (instance) => {
  const { workerOptions: config } = instance;
  const rootPath = path.resolve(config.root);
  const staticWorkerPool = new WorkerPool({ overallLimit: os.cpus().length, logger: logger.info });
  const workerPool = new WorkerPool({ overallLimit: config.limit, logger: logger.info });

  return (request, response, next) => {
    const {
      query: queryStringParameters,
      pathname
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
        const pathFragments = pathname.split(/\//gi).filter(Boolean);
        let currentPathFragments = pathFragments.slice();

        if (currentPathFragments.find(p => FORBIDDEN_PATHS.includes(p))) return next();

        let pathExists = false;
        for (let i = currentPathFragments.length; i >= 0; i--) {
          if (!pathExists) {
            currentPathFragments.splice(i);
            pathExists = existsSync(path.join(rootPath, ...currentPathFragments));
          }
        }

        let indexPath = path.join(rootPath, ...currentPathFragments);

        if (currentPathFragments.length < pathFragments.length) {
          let indexFound = false;
          for (let i = currentPathFragments.length; i >= 0; i--) {
            if (!indexFound) {
              currentPathFragments.splice(i);
              indexFound = !!config.index.find(indexFile => {
                const checkIndexFilePath = path.join(rootPath, ...currentPathFragments, indexFile);
                if (existsSync(checkIndexFilePath)) {
                  isIndex = true;
                  indexPath = checkIndexFilePath;
                  return true;
                }
              });
            }
          }
        } else if (config.index.find(indexFile => {
          const checkIndexFilePath = path.resolve(indexPath, indexFile);

          if (existsSync(checkIndexFilePath)) {
            indexPath = checkIndexFilePath;
            isIndex = true;
            return true;
          }
        })) { // detect index for trailing slash

        } else {
          config.index.find(indexFile => {
            if (pathname.indexOf(indexFile) === pathname.length - indexFile.length) {
              isIndex = true;
              return true;
            }
          });
        }

        /** @var {RequestEvent} event */
        const event = {};
        event.httpMethod = request.method.toUpperCase();
        event.protocol = isWebSocket(request) ? PROTOCOLS.WEBSOCKET : PROTOCOLS.HTTP;
        event.path = pathname;
        event.pathFragments = pathFragments;
        event.queryStringParameters = queryStringParameters;
        event.headers = request.headers;
        event.body = request.body;

        if (isIndex) {
          logger.info(`[${getDate()}] Invoking worker`, indexPath);

          Promise.resolve()
            .then(() => workerPool.getWorker(`${path.resolve(__dirname, './workerInvoke.js')} ${indexPath.replace(/\\/gi, '/')}`, config.options, config.limitPerPath))
            .then(worker => {
              worker.busy = true;
              const requestId = uuid();

              const requestSocketListener = data => {
                logger.info(`[${getDate()}] [${requestId}] [ws data in] ${parseWsMessage(data)}`);
              };
              if (event.protocol === PROTOCOLS.WEBSOCKET) {
                request.socket.on('data', requestSocketListener);
              }

              const messageListener = responseEvent => {
                if (responseEvent.requestId === requestId) {
                  if (responseEvent.type === WORKER_EVENT.RESPONSE) {
                    worker.postMessage({
                      type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE,
                      requestId,
                    });
                    const { event } = responseEvent;
                    const bufferEncoding = event.isBase64Encoded ? 'base64' : 'utf8';

                    response.writeHead(event.statusCode, event.headers);
                    response.write(Buffer.from(event.body, bufferEncoding));
                    response.end();
                  }

                  if (responseEvent.type === WORKER_EVENT.WS_MESSAGE_SEND) {
                    logger.info(`[${getDate()}] [${requestId}] [ws data out] ${responseEvent.event.frame}`);
                    request.socket.write(constructWsMessage(responseEvent.event.frame));
                  }

                  if (responseEvent.type === WORKER_EVENT.REQUEST_ACKNOWLEDGE) {
                    worker.busy = false;
                  }
                }
              };

              const requestCloseListener =  () => {
                worker.postMessage({
                  type: WORKER_EVENT.WS_CONNECTION_CLOSE,
                  requestId,
                  event
                });
                if (request.socket && request.socket.off) request.socket.off('close', requestCloseListener);
              };
              request.socket.on('close', requestCloseListener);

              worker.addEventListener('message', messageListener);
              worker.postMessage({
                type: WORKER_EVENT.REQUEST,
                requestId,
                event,
              });

              const cleanupConnection = () => {
                worker.removeEventListener('message', messageListener);
                if (request && request.off) {
                  request.off('close', cleanupConnection);
                  request.off('aborted', cleanupConnection);
                }

                if (request.socket && request.socket.off) {
                  request.socket.off('data', requestSocketListener);
                  request.socket.off('close', requestCloseListener);
                }
              };
              request.on('close', cleanupConnection);
              request.on('aborted', cleanupConnection);
              if (event.protocol === PROTOCOLS.HTTP) {
                response.on('finish', cleanupConnection)
              }
            });
        } else if (['GET', 'HEAD'].includes(request.method.toUpperCase())) {
          logger.info(`[${getDate()}] Invoking worker`, indexPath);

          Promise.resolve()
            .then(() => staticWorkerPool.getWorker(`${path.resolve(__dirname, './staticWorkerInvoke.js')}`, { cwd: process.cwd(), }, 1))
            .then(worker => {
              const requestId = uuid();

              const messageListener = responseEvent => {
                if (responseEvent.requestId === requestId) {
                  if (responseEvent.type === WORKER_EVENT.RESPONSE) {
                    worker.postMessage({
                      type: WORKER_EVENT.RESPONSE_ACKNOWLEDGE,
                      requestId,
                    });
                    const { event } = responseEvent;
                    const bufferEncoding = event.isBase64Encoded ? 'base64' : 'utf8';

                    response.writeHead(event.statusCode, event.headers);
                    response.write(Buffer.from(event.body, bufferEncoding));
                    response.end();
                  }

                  if (responseEvent.type === WORKER_EVENT.REQUEST_ACKNOWLEDGE) {
                    worker.busy = false;
                  }
                }
              };

              worker.addEventListener('message', messageListener);

              event.rootPath = rootPath;
              worker.postMessage({
                type: WORKER_EVENT.REQUEST,
                requestId,
                event,
              });

              const cleanupConnection = () => {
                worker.removeEventListener('message', messageListener);
                if (request && request.off) {
                  request.off('close', cleanupConnection);
                  request.off('aborted', cleanupConnection);
                }
              };
              request.on('close', cleanupConnection);
              request.on('aborted', cleanupConnection);
              response.on('finish', cleanupConnection)
            });
        }
      });
  };
};

module.exports = workerMiddleware;
