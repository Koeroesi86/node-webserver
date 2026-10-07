# NodeJS Web Server

This package brings ability to deploy webapps a lot easier. Just copy [configuration.example.js](configuration.example.js) to `configuration.js`, modify it to your needs and start server instantly. Configuration also supported in `configuration.json` format.

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)
* [pnpm](https://pnpm.io/) (`corepack enable`)
* For Windows usage
    1. [Python](https://www.python.org/)
    1. [Visual C++ Build Tools](https://www.visualstudio.com/downloads/#build-tools-for-visual-studio-2017)
    1. Windows build tools
     
        From an administrator console:

        ```npm install --global --production windows-build-tools```


### Usage

Please enter in a console/terminal:
    
    pnpm install
    pnpm start

`pnpm start` compiles the TypeScript sources in `src/` to `dist/` and restarts on changes. `pnpm build` creates the published `dist/` output once, `pnpm test` runs the Jest suite and `pnpm lint` checks formatting.


### Compression

Compression is off. Switch it on for a server with `compression` in its definition:

```javascript
{
  hostname: 'web.localhost',
  protocol: 'http',
  type: 'worker',
  compression: true, // or { threshold: 512, level: 6, brotliQuality: 4, encodings: ['br', 'gzip'] }
  options: { root: '/path/to/files' },
}
```

Responses of text like types (text, JSON, JavaScript, XML, SVG, some fonts) are compressed with brotli, gzip or deflate, whichever the client accepts and likes most,
when they are at least `threshold` bytes (1024 by default) or of unknown size. Streamed responses stay streamed, as every part is flushed. The compression runs on the
threads of node, not on the one that serves the requests, but it still takes CPU: leave it to a reverse proxy or CDN if there is one in front of the server.

### Streaming request bodies

By default the body of a request is read into memory (up to `limitRequestBody`, 1 MB, bigger ones are answered with 413) before the worker is called, and the worker gets it as the string `event.body`.
Switch streaming on for a server with `streamRequestBody` in its options, then the worker is called at once and reads the body from `event.bodyStream`, a Readable:

```javascript
{
  hostname: 'upload.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: '/path/to/workers',
    streamRequestBody: true, // or (workerPath) => workerPath.endsWith('upload.js')
    limitStreamedRequestBody: 0, // bytes, 0 (the default) for no limit, a bigger body is answered with 413
  },
}
```

```javascript
module.exports = async (event, callback) => {
  let size = 0;
  for await (const chunk of event.bodyStream) size += chunk.length;
  callback({ statusCode: 200, headers: {}, body: String(size), isBase64Encoded: false });
};
```

The body is sent to the worker in parts, and only a few ahead of what the worker has read, so a worker that is slow, or a client that is fast, does not fill the memory: uploads of any size
need a flat amount of it. Things to know:
- Read the body before you answer. Once the response is complete the rest of the body is dropped and the stream is destroyed.
- The stream is destroyed with an error when the client goes away during the upload, `for await` throws it.
- `event.body` is empty for a streamed request. Requests without a body (GET, HEAD, DELETE, OPTIONS), websockets and the static worker are never streamed.
- The worker holds a request for as long as the upload takes. `limitResponseTimeout` counts from the last part that moved, a stalled upload is answered with 504 after it.

### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
