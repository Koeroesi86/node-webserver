const minimist = require('minimist');
const fs = require('fs');

const { TMP } = process.env;

const {
  lambda,
  handler = 'handler',
} = minimist(process.argv.slice(2));

if (TMP) {
  // moduleAlias.addAliases({ 'tmp': tmp });
  console.log('env', process.env)
}

console.log('TMP', TMP)
// console.log('tmp c', fs.readdirSync('tmp'))
// fs.writeFileSync('tmp/test.txt', 'test', 'utf8')

let requestInProgress;

Promise.resolve()
  .then(() => new Promise(resolve => {
    const timeout = 15 * 60 * 1000; // setting to default AWS timeout
    setTimeout(() => resolve('Shutting down lambda'), timeout);
  }))
  .then(message => {
    console.log(message);
    return new Promise(resolve => {
      // graceful shutdown wait
      const interval= setInterval(() => {
        if (!requestInProgress) {
          clearTimeout(timeout);
          resolve();
        }
      }, 10);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 5000);
    });
  })
  .then(() => process.exit(0));

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

  requestInProgress = true;
  const lambdaHandler = require(lambda)[handler];
  lambdaHandler(message, {}, (error, response) => {
    requestInProgress = false;
    if (error) {
      return process.send({
        statusCode: error.statusCode || 500,
        body: error.body || `${error}`,
      });
    }

    process.send(response);
  })
});
