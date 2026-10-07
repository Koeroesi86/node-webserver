# Node Worker Express [![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)

Express JS library for [@koeroesi86/node-worker](https://www.npmjs.com/package/@koeroesi86/node-worker)

Usage:
```javascript
const { middleware } = require('@koeroesi86/node-worker-express');
const express = require('express');
const path = require('path');

const app = express();
app.use(middleware({ root: path.resolve('./public') }));
app.listen(80);
```

### To run the example included:
```bash
pnpm install
pnpm --filter @koeroesi86/node-worker-express build
pnpm --filter @koeroesi86/node-worker-express start
```

For all options see [types](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/src/types/index.ts).

## Streaming a response

A worker answers a request by calling `callback` once. To send a body that is generated while it goes out, or is too big to hold in memory, use `streamResponse`:

```javascript
const { streamResponse } = require('@koeroesi86/node-worker-express');

module.exports = async (event, callback) => {
  async function* lines() {
    for (let index = 0; index < 1000; index += 1) yield `line ${index}\n`;
  }

  await streamResponse(callback, { headers: { 'Content-Type': 'text/plain' } }, lines());
};
```

The body can be a `Readable` or any async iterable of `Buffer`, `Uint8Array` or `string`. Parts are sent a few at a time and the next ones only
once the client took the earlier ones, so a slow client slows the source down instead of filling the memory. When the client goes away the source is
stopped (an async generator runs its `finally`, a `Readable` is destroyed) and `streamResponse` resolves with `false`. The response is sent chunked unless
you set a `Content-Length`. Static files above 1 MiB are streamed the same way.

Producing very small chunks is wasteful, as every part takes a message to the main process: collect them into parts of some KiB.
