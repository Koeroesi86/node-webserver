const http = require('http');

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);

// a plain application that knows nothing of the server in front of it
http
  .createServer((request, response) => {
    const parts = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Handled-By': 'child' });
      response.end(JSON.stringify({ method: request.method, url: request.url, host: request.headers.host, body: Buffer.concat(parts).toString('utf8') }));
    });
  })
  .listen(port);
