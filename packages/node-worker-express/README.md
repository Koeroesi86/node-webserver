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

### Big responses skip the server

A response with a `Content-Length` of at least `handOffResponses` bytes (8 MiB by default, 0 turns it off, and it is off on Windows, where handing sockets over is not verified) is written by the worker itself:
the server hands the connection of the client to the worker, which writes the body to it, so the bytes do not pass through the one process that all downloads would share.
`streamResponse` does this by itself, a worker that calls `callback` on its own can ask with `callback({ statusCode, headers, handOff: true })`, which resolves with the socket or with `undefined` when the server keeps the connection.
Things to know:
- Only plain HTTP/1 connections qualify: not HTTPS (the TLS state lives in the server), HEAD, a response without a length or with `Transfer-Encoding`, or one that a middleware in front encodes (compression): those stream through the server as before.
  A middleware in front that changes the body in another way does not see it, set `handOffResponses: 0` then.
- The connection is closed after the body (`Connection: close`), a client opens a new one for its next request.
- The worker closes the connection of a client that takes nothing for `limitResponseTimeout`. A worker that dies while it writes leaves the client with a truncated body.

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

## Websockets

The worker answers the upgrade request (`event.protocol === 'WS'`) with the handshake, a `101` with `Sec-WebSocket-Accept` (see `examples/public/websocket/worker.js`), and is called again for every message of the client and when the connection closes:

```javascript
module.exports = async (event, callback) => {
  if (event.closed) return; // the connection is gone, stop what you started for it
  if (event.frame !== undefined) return callback({ sendWsMessage: true, frame: event.frame.toUpperCase() }); // a text message
  if (event.binaryFrame !== undefined) return callback({ sendWsMessage: true, frame: event.binaryFrame }); // a binary message
  // the upgrade: answer it once, and start what the connection needs
  callback({ statusCode: 101, headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Accept': '...' }, body: '' });
};
```

- The server reads the frames: a message that comes in many pieces or in many frames is passed on whole, text is decoded as UTF-8 (`event.frame`, a string), binary stays bytes (`event.binaryFrame`, a `Buffer`).
  A frame that breaks the protocol (not masked, reserved bits, bad UTF-8, ...) closes the connection with 1002 or 1007, a message above `limitWebSocketMessage` with 1009. Pings are answered, and the close of the client is, by the server, without the worker.
- A worker sends text with a string `frame`, binary with a `Buffer` (any size), and ends the connection with `callback({ sendWsMessage: true, close: { code: 1000, reason: 'bye' } })`.
- **The messages of a connection are handled one at a time, in the order they came in.** The worker is not called with the next one before the function (or the promise it returns) has finished with the one before.
- **Backpressure, towards the worker:** while the worker has not finished with the last 16 messages (or 1 MiB of them), the server stops reading the socket of the client, so a client that sends faster than the worker handles slows down, in the TCP window,
  and the memory of the server stays flat. Return a promise from the worker to hold the client back for as long as you work on a message.
- **Backpressure, towards the client:** `callback({ sendWsMessage: true, frame })` returns a promise that resolves with `true` once the message was written to the client, and with `false` when the connection is gone.
  A worker that `await`s it sends no faster than the client takes. The messages of a worker that does not wait are held by the server up to 8 MiB for a client, a client that reads even slower is closed with 1008.
- The messages written in the same turn of the event loop leave in one write, and the messages to the worker travel in the writes of the channel, which already joins those of a turn.
- The server pings an idle connection every `webSocketPingInterval` (30 s by default, 0 for none) and closes one that sent nothing, not even an answer to a ping, for `limitWebSocketIdleTimeout` (90 s, 0 never), as it would otherwise stay until the operating system gives up on it.
  A connection is not subject to the keep alive timeout of the HTTP server once it was upgraded, which used to close a quiet websocket after a few seconds.
- `limitWebSocketConnections` (1000 by default, 0 for no limit) is the number of connections one worker file may have at the same time, the next ones are answered with 503 and `Retry-After`. A connection holds a worker until it closes.
- `limitWebSocketMessage` (bytes, 1 MiB by default, 0 for no limit) is the largest message, and the largest frame.
- The worker is called with `closed: true` when a **websocket** connection closes, and not for HTTP requests any more. A second answer to the upgrade is ignored, and so is an answer that is not `sendWsMessage` to a message.

## Metrics

`await event.getMetrics()` in a worker gives a snapshot of the server (uptime, memory, event loop delay, request counts, worker pools) for health and metrics endpoints, see the README of `@koeroesi86/node-webserver`.
In the server process `getServerMetrics()` gives the same, and `registerMetricsSource(name, read)` adds a source to it.

## How the server and the workers talk

The messages between the server and a worker do not use the IPC channel of node (`child_process` with `'ipc'`, which serializes every message as JSON and turns a binary body into text), but a socket pair that
is the fourth stdio of the worker (a Unix domain socket, a named pipe on Windows). A message is a frame: the metadata as JSON and the body as raw bytes, so bodies are neither base64 encoded nor escaped,
and the messages written in the same turn of the event loop leave in a single write. Nothing listens anywhere, so there is nothing else to connect to and no token to protect: only the two processes hold the descriptor.
A worker that loses the server (the socket closes, also when the server was killed) exits.

What this changes for you:

- A worker file is called with `(event, callback)` as before, and answering works as before: `body` is a `string` (utf8, or base64 with `isBase64Encoded: true`) or a **`Buffer`**, which is sent as it is and is the cheapest for binary content.
  `streamResponse` and the static files use buffers too.
- **A worker script that uses `process.send` or `process.on('message')` to talk to the server breaks**, as the worker process has no IPC channel any more (`process.send` is `undefined`). Answer through `callback` instead.
  The protocol between the processes is internal and may change, only `callback` and `event` are the interface of a worker.
- The `stdio` option of `@koeroesi86/node-worker` is set by the middleware, a worker started through `middleware({ ... })` cannot pick its own.
