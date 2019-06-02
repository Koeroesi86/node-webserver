const getDate = require('./getDate');
const logger = require('./logger');

const fullUrl = request => `${request.protocol}://${request.get('host')}${request.originalUrl}`;
const serialiseHeaders = request => {
  const prepared = {};
  Object.keys(request.headers).sort().forEach(key => {
    prepared[key] = request.headers[key];
  });
  return JSON.stringify(prepared);
};

module.exports = (server, alias = 'APP') => {
  server.use((request, response, next) => {
    setTimeout(() => {
      const timePrefix = `[${getDate()}]`;
      logger.success([
        timePrefix,
        `[${alias}]`,
        'REQUEST',
        (request.method || '!no-method!').toUpperCase(),
        fullUrl(request),
        'HEADERS',
        `${serialiseHeaders(request)}`
      ].join(' '));
    }, 0);
    response.on('finish', () => {
      const timePrefix = `[${getDate()}]`;
      let log = message => logger.info(message);
      if (response.statusCode >= 200 && response.statusCode < 400) {
        log = message => logger.success(message);
      } else if (response.statusCode >= 400) {
        log = message => logger.error(message);
      } else if (response.statusCode < 200) {
        log = message => logger.warning(message);
      }
      const logLine = [
        timePrefix,
        `[${alias}]`,
        'RESPONSE',
        (request.method || '!no-method!').toUpperCase(),
        fullUrl(request),
        response.statusCode,
        response.statusMessage,
        `${response.get('Content-Length') || 0}b sent`
      ].join(' ');
      log(logLine);
    });
    next();
  });
};
