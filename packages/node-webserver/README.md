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

### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
