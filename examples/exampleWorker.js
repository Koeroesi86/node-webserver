module.exports = (event, callback) => {
  callback({
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=0',
    },
    body: '<h1>It works!</h1>',
    isBase64Encoded: false,
  });
};
