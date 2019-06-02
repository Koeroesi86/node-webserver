const minimist = require('minimist');

const {
  lambda,
  handler = 'handler'
} = minimist(process.argv.slice(2));

Promise.resolve()
  .then(() => new Promise(resolve => {
    const timeout = 15 * 60 * 1000; // setting to default AWS timeout
    setTimeout(() => resolve('Shutting down lambda'), timeout);
  }))
  .then(message => console.log(message));

/**
 * @typedef ResponseEvent
 * @property {Number} statusCode
 * @property {Object} headers
 * @property {String} body
 */

process.on('message', message => {
  if (!lambda) {
    return process.send({
      statusCode: 500,
      body: 'Please specify lambda path'
    });
  }

  const lambdaHandler = require(lambda)[handler];
  lambdaHandler(message, {}, (error, response) => {
    if (error) {
      return process.send({
        statusCode: error.statusCode || 500,
        body: error.body || `${error}`,
      });
    }

    process.send(response);
  })
});
