module.exports = (event, callback) => {
  callback({
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=0',
    },
    body: `
    <html>
      <head>
        <title>Example</title>
      </head>
      <body>
        <h1>It works!</h1>
      </body>
    </html>
    `,
    isBase64Encoded: false,
  });
};
