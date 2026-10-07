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

## Reading the body of a request

The body is not part of the event a worker is called with: the worker is called at once, and reads the body from `event.bodyStream`, a `Readable` (empty for requests without a body):

```javascript
module.exports = async (event, callback) => {
  let size = 0;
  for await (const chunk of event.bodyStream) size += chunk.length;
  callback({ statusCode: 200, headers: {}, body: String(size), isBase64Encoded: false });
};
```

Only a few parts are on their way to the worker before it has read the earlier ones, so uploads of any size take a flat amount of memory. A worker that needs all of it uses `stream/consumers`:
`const body = await text(event.bodyStream)` (also `json` and `buffer`). **`event.body` does not exist any more.** Read the body before you answer, as the rest of it is dropped once the response is complete.
A client that goes away during the upload destroys the stream with an error. `limitRequestBody` (bytes, 0 for none, the default) answers a bigger body with 413. Websockets and static files never have a body.

## Metrics

`await event.getMetrics()` in a worker gives a snapshot of the server (uptime, memory, event loop delay, request counts, worker pools) for health and metrics endpoints, see the README of `@koeroesi86/node-webserver`.
In the server process `getServerMetrics()` gives the same, and `registerMetricsSource(name, read)` adds a source to it.
