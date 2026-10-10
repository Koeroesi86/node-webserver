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
- The `lambda` server type does not pass the body of a request to the lambda yet (#38).

### Websockets

A worker answers the upgrade and is called for every message, see the README of `@koeroesi86/node-worker-express`. The server reads the frames (messages in pieces, UTF-8 text, binary, ping, close), holds the client back while the worker is behind,
and holds the worker back (`await callback({ sendWsMessage: true, frame })`) while the client is behind. These options of the server limit them: `limitWebSocketMessage` (bytes, 1 MiB), `limitWebSocketConnections` (per worker file, 1000),
`webSocketPingInterval` (30000 ms) and `limitWebSocketIdleTimeout` (90000 ms). Websockets of `child` servers are not proxied (see #56).

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
| `requests` | `total`, `active` (no complete response yet), `status`, the responses by class (`2xx` ... `5xx`), and `latencyMs`, how long they took (below) |
| `sources` | `workers:<host name>` for each worker server (`workers`, `active` requests, `waiting` requests, `refused`, `failing`, the worker files that crashed in a row, the same per worker file under `paths`, and `latencyMs` per worker file), `lambdas` (`lambdas`, `busy`, `starting`, `waiting` requests, `abandoned` requests, per file), `connections:http` and `connections:https` (`open`, `dropped`, the settings) |

`latencyMs` is a histogram of the time from the request to the close of its response: `count`, `sumMs`, `maxMs`, the number of requests in each of fixed buckets (`buckets`, by their upper bound in milliseconds from `1` to `30000`, and `+Inf`,
not cumulative), and `p50`, `p90` and `p99`, which are the upper bound of the bucket they fall into. Counting a request only adds to numbers that exist, so it costs no memory per request. Per worker server it is kept by worker file,
the static files under the static worker, and the first 100 worker files get one each, the others share `(other)`, so a client that asks for many different paths cannot grow the metrics. A websocket counts until its upgrade is answered, not for as long as it stays open.

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
instead of piling up. `refused` in the metrics of the worker pool counts both. A request whose client goes away while it waits leaves the line at once, without taking a worker
or delaying the ones behind it, and is counted as `abandoned`.

### Lambdas

A `lambda` server runs an AWS Lambda style handler (`lambdaOptions.lambda` is the file, `handler` the export, `handler` by default), each lambda in a process of its own that answers one request at a time.
The options of `lambdaOptions`:

| | |
| --- | --- |
| `limit` | how many lambdas the server may run, the number of CPU cores by default, 0 for no limit. Every lambda server has a limit of its own, and the worker servers have theirs: a configuration with several of them can run up to the sum of their limits as processes. |
| `acquireTimeout` | how long a request waits for a lambda when all of them are busy and the limit is reached, 10000 ms by default, then it is answered with 503 |
| `startTimeout` | how long a lambda may take to load its module and start, 10000 ms by default, then it is stopped and the request is answered with 502 |
| `timeout` | how long the handler may take to answer, 900000 ms (15 minutes) by default, then the lambda is stopped and the request is answered with 504 |
| `env` | variables for the lambdas. They do not get the environment of the server, only what node needs (`PATH`, `HOME`, `TZ`, `NODE_OPTIONS`, the proxies, ...) and what AWS sets for a function (`AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT`, `_HANDLER`) |
| `communication` | how the request and the response reach the lambda, `ipc` (default) or `file` |

Requests that find all lambdas busy wait in line, the one that came first is served first, and are woken as soon as a lambda is free or one exits, nothing polls. A request whose client goes away while it waits leaves the line without taking a lambda
(`abandoned` in the metrics counts them, `waiting` is the length of the line). The limits of the lambda servers and of the worker servers are independent of each other: a configuration with several of them can run up to the sum of their limits as processes.

Failures are answered the way API Gateway answers them, with a JSON object with a `message`: a handler that fails (an error to the callback, or a throw), a response without a valid `statusCode` or with a `body` that is not a string, a lambda that does not start
or exits during the request give 502 `{"message":"Internal server error"}`, the error goes to the log. A handler that takes longer than `timeout` gives 504 `{"message":"Endpoint request timed out"}`, and a full line 503 `{"message":"Service Unavailable"}`.
Known limits, tracked in #38: one request per lambda at a time (like AWS, but without scaling out), a lambda stops 15 minutes after it started, the body of a request is not passed, and `async` handlers are not supported (call the callback).

### Idle workers and the limit for all servers

A worker that has had no request for `limitWorkerIdleTimeout` (5 minutes by default, 0 to keep them) is stopped, and the next request for its file starts one again, so that files that were asked for once do not keep a process each.
`workerLimit` in the top level of the configuration (0 by default, for no limit) is the number of worker processes that all the worker servers may run together, next to the `limit` of each server.
When either is used up and a file has no worker, an idle worker is stopped to make room for it: a second worker of a file before the last one, and the one that has been idle longest first.
The last worker of a file is only taken while it has no request, so a busy file cannot starve the others. `evicted` in the metrics of a worker pool counts the workers stopped for being idle (`idle`) and to make room (`forRoom`),
and the `workers` metrics show the processes of all the servers against `workerLimit`.

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
