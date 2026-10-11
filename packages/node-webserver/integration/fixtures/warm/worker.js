const { appendFileSync } = require('fs');

// every start of the process is written down, which is when the module is loaded: with the worker kept warm that is before any request
appendFileSync(process.env.WARM_MARKER, `${process.pid}\n`);

module.exports = (event, callback) =>
  callback({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: `${process.pid}`, isBase64Encoded: false });
