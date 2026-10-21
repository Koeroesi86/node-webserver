# Node Worker Express [![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)

Express JS library for [@koeroesi86/node-worker](https://www.npmjs.com/package/@koeroesi86/node-worker), on the pool of worker processes of [@koeroesi86/node-worker/pool](../node-worker#the-pool-of-worker-processes)

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

`closeWebSockets(code = 1001, reason)` closes every websocket connection that is open with a close frame, for a process that is stopping (`node-webserver` calls it on `SIGTERM`).

`middleware.close(timeout)` stops the workers of a middleware that is not used any more, each once it answered the requests it took, or all of them after `timeout` milliseconds, and removes its pool from the metrics and from its `workerBudget`. It resolves once the workers stopped.

A middleware without a `workerBudget` stops its workers when the process exits. With one it does not: call `budget.close()` from an exit listener, which stops the workers of all the pools in it at once.

For all options see [types](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/src/types/middleware.ts).

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

A response with a `Content-Length` of at least `handOffResponses` bytes (8 MiB by default, 0 turns it off) is written by the worker itself:
the server hands the connection of the client to the worker, which writes the body to it, so the bytes do not pass through the one process that all downloads would share.
`streamResponse` does this by itself, a worker that calls `callback` on its own can ask with `callback({ statusCode, headers, handOff: true })`, which resolves with the socket or with `undefined` when the server keeps the connection.
Things to know:
- Only plain HTTP/1 connections qualify: not HTTPS (the TLS state lives in the server), HEAD, a response without a length or with `Transfer-Encoding`, or one that a middleware in front encodes (compression): those stream through the server as before.
  A middleware in front that changes the body in another way does not see it, set `handOffResponses: 0` then.
- The connection is closed after the body (`Connection: close`), a client opens a new one for its next request.
- The worker closes the connection of a client that takes nothing for `limitResponseTimeout`. A worker that dies while it writes leaves the client with a truncated body.

Producing very small chunks is wasteful, as every part takes a message to the main process: collect them into parts of some KiB.

## Static files

A path that no worker answers is served by the static worker, `GET` and `HEAD` only, with an `ETag`, `Last-Modified` and conditional requests (`304`). Files above 1 MiB are streamed, smaller ones are kept in memory.
All of it runs in the worker, not in the server. The `static` option tunes it:

```js
middleware({
  root,
  static: {
    cacheControl: [
      { folder: '/assets/', extension: 'js', value: 'public, max-age=31536000, immutable' },
      { extension: '.css', value: 'public, max-age=3600' },
    ],
    listDirectories: true,
    precompressed: ['br', 'gzip'],
  },
});
```

- **Percent-encoded paths** are decoded once before the file is looked up, so `/a%20b.txt` serves `a b.txt` (and the links of a directory listing open). A malformed escape (`%zz`, a lone `%`) is answered with 404, and the decoded path must still be below `root`: `%2e%2e`, `%2f` and `%5c` cannot lead out of it. `cacheControl` rules still match the path as sent.
- **Range requests** are always answered: a single range (`bytes=2-4`, `bytes=7-`, `bytes=-3`) with `206`, `Content-Range` and `Accept-Ranges: bytes`, `416` with `Content-Range: bytes */size` for one outside of the file.
  `If-Range` is compared with the `ETag` (also without its weak prefix, as it derives from the size and the modification time) or the `Last-Modified` date, a file that changed is sent whole.
  Several ranges, another unit and a header that is not valid are ignored and the whole file is sent. A range of a big file is streamed from the file, a small one is cut from memory. A `206` is not compressed by `compression`.
- **`cacheControl`**: rules of a `folder` of the request path, an `extension` or both (both must match), the first match sets `Cache-Control`. Without a match it is `public, max-age=0`.
- **`listDirectories`** (off by default): a folder without an index file (`index.html`) is answered with a list of it instead of 404, folders first. Names are escaped, files starting with a dot are left out.
  A folder requested without the closing slash is redirected to it (`301`).
- **`precompressed`** (off by default): for `app.js` the worker looks for `app.js.br` (`br`) and `app.js.gz` (`gzip`) and sends the first one in the list that the client accepts, with `Content-Encoding`, its own `ETag` and `Content-Type` of the original.
  `Vary: Accept-Encoding` is set for every file that has a variant. The compression of the server leaves such a response alone. Build the variants yourself, they are not made or refreshed here.

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

### Big uploads skip the server

A request with a `Content-Length` of at least `handOffRequests` bytes (0, which turns it off, by default) is read by the worker itself: once the head of the request has been read, the server hands the connection of the client to the worker
together with the request and the part of the body that had arrived, so the bytes of a big upload do not pass through the one process that all uploads would share. `event.bodyStream` is the same stream as before, a worker does not change.
Things to know:
- Only plain HTTP/1 connections with a known length qualify: not HTTPS (the TLS state lives in the server), chunked bodies (`Transfer-Encoding`), websockets and bodies that arrived with the request (`inlineRequestBody`): those stream through the server as before.
  A body that is announced bigger than `limitRequestBody` is not handed over, it is answered with 413 by the server as before.
- The worker writes the response to the client itself, after reading the body or before (an early 413 for example). A middleware in front does not see it: no compression, no headers it would add. The access log has the status and the length of the body the worker wrote.
  The connection is closed after the response (`Connection: close`), a client opens a new one for its next request. Bytes that follow the body on the connection are dropped.
- The worker answers 504 (`Worker did not respond in time.`) when nothing moves on the connection for `limitResponseTimeout` and it has written nothing yet, then closes the connection. A client that keeps sending the body does not time out, whether the worker reads it or not. A response that is under way is closed without a status, as the status line cannot be taken back.
  A worker whose event loop is blocked cannot fire its timer, so its client waits, and a worker that dies leaves the client with a closed connection instead of a 502.
- A client that goes away during the upload destroys `bodyStream` with an error, as before.

## Routes

By default the worker of a request is found in the files under `root`: the middleware walks up from the path and looks for a folder or file with an `index` worker. `routes` names the worker of some paths instead,
so that a request for them does not ask the file system, and the worker does not have to sit in a folder that mirrors the URL:

```javascript
app.use(middleware({
  root: path.resolve('./public'),
  index: ['index.js'],
  routes: [
    { path: '/health', worker: 'workers/health.js' },
    { pattern: '/items/(?<id>[0-9]+)', worker: '/srv/app/items.js' },
    { pattern: '/files/(?<name>[a-z0-9-]+)\\.txt', flags: 'i', worker: '../shared/files.js' },
  ],
  fallthrough: true,
}));
```

- A route has either a `path`, which is the path of the request as it is (a lookup in a map), or a `pattern`, a regular expression that the whole path has to match (it is anchored at both ends), with the `flags` `i`, `s`, `u` or `v`.
  The query is not part of the path. The routes are tried in their order, and the first one that matches wins.
- The named groups of the pattern are handed to the worker as `event.pathParameters`, as they are in the path (not decoded): `{ id: '12' }` for `/items/12`.
- `worker` is a file, relative to `root` or absolute, and it may be outside of `root`. It is always that file: the worker is never made from the path, so a request cannot reach a file the configuration does not name.
- The routes are checked when the middleware is created, which throws for a worker that is not a file, a pattern that is not valid, or a flag that cannot be used.
- Paths with `..` are refused before the routes are looked at, and a path longer than 2048 characters matches no route.
- A request that matches no route is looked for under `root` (`fallthrough: true`, the default). With `fallthrough: false` it is answered with 404 by the middleware, without a worker.
- The patterns run in the server process for every request that gets to them, against what the client sent. They are trusted configuration: keep them simple, and avoid ones that backtrack a lot, like nested repetitions (`(a+)+`).

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
