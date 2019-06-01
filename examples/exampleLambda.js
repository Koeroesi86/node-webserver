const { resolve } = require('path');
const fs = require('fs');
const mime = require('mime-types');

module.exports.handler = (event, context, callback) => {
  const path = `${event.path.replace(/\.{2,}/, '')}${/\/$/.test(event.path) ? 'index.html' : ''}`;
  const fileName = resolve(__dirname, `./static/${path}`);
  if (fs.existsSync(fileName)) {
    const bodyBuffer = fs.readFileSync(fileName);
    const contentType = mime.contentType(fileName);
    callback(null, {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
      },
      body: /^(text|application)\//.test(contentType)
        ? bodyBuffer.toString('utf8')
        : bodyBuffer.toString('binary')
    });
  } else {
    callback(null, {
      statusCode: 404,
      headers: {
        'Content-Type': 'text/html'
      },
      body: ''
    });
  }
};
