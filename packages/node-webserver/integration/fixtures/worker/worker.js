const { buffer } = require('stream/consumers');

// answers with what it received, or with a big text to be compressed
module.exports = async (event, callback) => {
  const body = await buffer(event.bodyStream);
  const size = Number(event.queryStringParameters.size);

  callback({
    statusCode: 200,
    headers: { 'Content-Type': size ? 'text/plain' : 'application/json', 'X-Handled-By': 'worker' },
    body: size ? 'a'.repeat(size) : JSON.stringify({ method: event.httpMethod, path: event.path, query: event.queryStringParameters, body: body.toString('utf8') }),
    isBase64Encoded: false,
  });
};
