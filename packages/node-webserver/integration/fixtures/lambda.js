exports.handler = (event, context, callback) => {
  if (event.path === '/fail') {
    return callback(new Error('boom'));
  }

  if (event.path === '/binary') {
    return callback(null, {
      statusCode: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from([0, 1, 2, 255]).toString('base64'),
      isBase64Encoded: true,
    });
  }

  callback(null, {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', 'X-Handled-By': 'lambda' },
    body: JSON.stringify({ method: event.httpMethod, path: event.path, query: event.queryStringParameters }),
  });
};
