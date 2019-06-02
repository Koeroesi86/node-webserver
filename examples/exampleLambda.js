const { resolve } = require('path');
const fs = require('fs');
const mime = require('mime-types');
const etag = require('etag');
const moment = require('moment');

module.exports.handler = (event, context, callback) => {
  const path = `${event.path.replace(/\.{2,}/, '')}${/\/$/.test(event.path) ? 'index.html' : ''}`;
  const fileName = resolve(__dirname, `./static/${path}`);
  if (fs.existsSync(fileName)) {
    const bodyBuffer = fs.readFileSync(fileName);
    const stats = fs.statSync(fileName);
    const contentType = mime.lookup(fileName);
    const isText = /^(text\/|	application\/json)/.test(contentType);
    const body = isText ? bodyBuffer.toString('utf8') : bodyBuffer.toString('base64');
    const currentEtag = etag(body);
    callback(null, {
      statusCode: 200,
      headers: {
        'Content-Type': isText ? `${contentType}; charset=${mime.charset(contentType).toLowerCase()}` : contentType,
        'Content-Length': bodyBuffer.length,
        'Cache-Control': 'public, max-age=0',
        'ETag': currentEtag,
        ...(stats.mtime && { 'Last-Modified': moment(stats.mtime).format('ddd, DD MMM YYYY HH:mm:ss') + ' GMT' }),
      },
      body: body,
      isBase64Encoded: !isText,
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
