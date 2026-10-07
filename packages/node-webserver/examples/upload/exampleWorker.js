const crypto = require('crypto');

// takes the body of a request as a stream, `streamRequestBody` has to be on for the server: it never holds more than a few parts in memory, whatever the size of the upload
// answers with the size and the sha256 of what it received
module.exports = async (event, callback) => {
  const hash = crypto.createHash('sha256');
  let size = 0;

  // a server that does not stream bodies passes it in `event.body`
  for await (const chunk of event.bodyStream ?? [event.body]) {
    hash.update(chunk);
    size += Buffer.byteLength(chunk);
  }

  callback({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, sha256: hash.digest('hex') }),
    isBase64Encoded: false,
  });
};
