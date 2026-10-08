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

`pnpm start` compiles the TypeScript sources in `src/` to `dist/` and restarts on changes. `pnpm build` creates the published `dist/` output once, `pnpm test` runs the Jest suite, `pnpm test:integration` starts the built server (run `pnpm build` first) with a worker, a lambda (both communications) and a child server from [integration/fixtures](integration/fixtures) and sends requests to them, and `pnpm lint` checks formatting.


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

### Request bodies

The body of a request is not part of the event a worker is called with. The worker is called as soon as the request arrives, and reads the body from `event.bodyStream`, a Readable, while it comes in.
Every request has one, it is empty when the request has no body. The body goes to the worker in parts, and only a few ahead of what the worker has read, so a slow worker, or a fast client, does not fill the memory:
uploads of any size need a flat amount of it.

```javascript
module.exports = async (event, callback) => {
  let size = 0;
  for await (const chunk of event.bodyStream) size += chunk.length;
  callback({ statusCode: 200, headers: {}, body: String(size), isBase64Encoded: false });
};
```

A worker that needs the whole body reads it into memory itself, with what node has for it (`stream/consumers`):

```javascript
const { buffer, json, text } = require('stream/consumers');

module.exports = async (event, callback) => {
  const payload = await json(event.bodyStream); // or text(...), or buffer(...) for the bytes
  callback({ statusCode: 200, headers: {}, body: JSON.stringify({ received: payload }), isBase64Encoded: false });
};
```

A body that has already arrived with the request and is small (up to `inlineRequestBody` bytes, 65536 by default, 0 to turn it off) is not sent in parts: it goes along with the request, which saves the messages of a stream. The worker reads it from
`event.bodyStream` all the same. Bigger bodies, and ones that arrive after the request, are streamed as described. A body is one or the other, never both.

Things to know:
- **`event.body` is gone.** Workers that read it get `undefined` and have to read `event.bodyStream` instead, as above. The server does not read bodies into memory any more, nor stop at 1 MB:
  `limitRequestBody` in the options of the server is the largest body in bytes that is let through (413 above it), 0 for no limit, which is the default.
- Read the body before you answer. Once the response is complete the rest of the body is dropped and the stream is destroyed.
- The stream is destroyed with an error when the client goes away during the upload, `for await` throws it.
- Requests that have no body (GET, HEAD, DELETE, OPTIONS), websockets and the static worker never get one.
- The worker holds a request for as long as the upload takes. `limitResponseTimeout` counts from the last part that moved, a stalled upload is answered with 504 after it.
- The `lambda` server type still reads the whole body first.

### Metrics for workers

A worker can ask the server how it is doing with `event.getMetrics()`, which makes it easy to add a health or metrics endpoint. The server is one process and the workers are others, so this is a question over the channel to the server,
answered with a snapshot:

```javascript
module.exports = async (event, callback) => {
  const metrics = await event.getMetrics();
  callback({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metrics), isBase64Encoded: false });
};
```

| | |
| --- | --- |
| `uptimeSeconds`, `memory` | of the server process: `rss`, `heapTotal`, `heapUsed`, `external` |
| `eventLoopDelayMs` | `mean`, `p99` and `max` of how late the event loop ran since the metrics were read the last time (all zero the first time): the best sign that the server is too busy |
| `requests` | `total`, `active` (no complete response yet) and `status`, the responses by class (`2xx` ... `5xx`) |
| `sources` | `workers:<host name>` for each worker server (`workers`, `active` requests, `waiting` requests, `refused`, `failing`, the worker files that crashed in a row, and the same per worker file under `paths`), `lambdas` (`lambdas`, `busy`, `starting`, per file), `connections:http` and `connections:https` (`open`, `dropped`, the settings) |

`examples/health/exampleWorker.js` is a worker with `/health` (200, or 503 while requests wait for a worker) and `/metrics`. Mind that a health endpoint is a worker like the others: it is reachable by anyone who can reach its host name.
Part of the numbers are counted since the server started, a scraper computes rates from them. The existing stats domain (`statsDomain`) reports CPU and memory per process.
`getServerMetrics()` and `registerMetricsSource(name, read)` are exported by `@koeroesi86/node-worker-express`, to read the same numbers in the server process or add your own.

### Logging

The access logs and everything else that is logged go to the console in one write at the end of every turn of the event loop, and to the files in one write per file every 100 milliseconds (`fileLogFlushInterval`), as every write is a system call
on the thread that serves the requests. Lines of other code that write to the console directly can come out before the lines of the turn, by at most that turn. A level that is switched off costs nothing, its lines are not even built.

### Waiting for a worker

A request is handed a worker of its worker file at once, also when all of them are busy: workers handle several requests at a time, and a request waits only when its file has no worker and no more can be started, because the limit for all
workers (`limit`) is used up by other files. Those requests wait in line, the one that came first is served first, and are woken as soon as there is room (a request is finished and a worker of another file can make room, a worker stops),
nothing polls. A request that has waited for `limitRequestTimeout` (5 seconds by default), or that finds `limitQueue` requests waiting already (1000 by default, 0 for no limit), is answered with 503 and `Retry-After: 1` at once,
instead of piling up. `refused` in the metrics of the worker pool counts both.

### Workers that crash

A worker that stops with an error, or at all within 5 seconds of starting, has crashed. The first crash is answered by starting another worker for the next request, as before.
After the second one in a row the server stops starting workers for that path for a while, 100 milliseconds at first and twice as long after every further crash up to 10 seconds, instead of starting a process for every request.
Requests that arrive in the meantime are answered with 503 and a `Retry-After`, unless a worker for the path is still running, which takes them. A worker that stays up for 5 seconds clears the count.
`failing` in the metrics lists the paths that are held back, with their crashes and the time left. Workers the server stops itself (an idle one that makes room, the shutdown) are no crash.

What a worker writes to its stdout and stderr is handed to `onStdout` and `onStderr` from the moment it starts.

### Connections

`keepAliveTimeout` (milliseconds, default 65000) is how long the server keeps an idle connection of a client open. Node closes them after 5 seconds, which is shorter than what load balancers and proxies keep theirs for (60 seconds is common),
and a request that was sent over a connection that has just been closed fails. `maxConnections` (default 10000, 0 for no limit) is the number of open connections per server (http and https each) after which new ones are dropped,
which the `connections:*` metrics count. Both are in the top level of the configuration, next to the ports.

### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
