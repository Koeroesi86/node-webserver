# NodeJS Web Server

This package brings ability to deploy webapps a lot easier. Just copy [configuration.example.js](configuration.example.js) to `configuration.js`, modify it to your needs and start server instantly. Configuration also supported in `configuration.json` format.

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)
* [pnpm](https://pnpm.io/) (`corepack enable`)

### Usage

Please enter in a console/terminal:
    
    pnpm install
    pnpm start

`pnpm start` compiles the TypeScript sources in `src/` to `dist/` and restarts on changes. `pnpm build` creates the published `dist/` output once, `pnpm test` runs the Jest suite, `pnpm test:integration` starts the built server (run `pnpm build` first) with a worker, a lambda and a child server, and HTTP/2 and websockets on the https port, from [integration/fixtures](integration/fixtures) and sends requests to them, and `pnpm lint` checks formatting.


### Compression

Compression is off. Switch it on for a server with `compression` in its definition:

```javascript
{
  hostname: 'web.localhost',
  protocol: 'http',
  type: 'worker',
  compression: true, // or { threshold: 512, level: 6, brotliQuality: 4, encodings: ['br', 'gzip'], concurrency: 4 }
  options: { root: '/path/to/files' },
}
```

Responses of text like types (text, JSON, JavaScript, XML, SVG, some fonts) are compressed with brotli, gzip or deflate, whichever the client accepts and likes most,
when they are at least `threshold` bytes (1024 by default) or of unknown size. Streamed responses stay streamed, as every part is flushed. The compression runs on the
threads of node, not on the one that serves the requests, but it still takes CPU: leave it to a reverse proxy or CDN if there is one in front of the server.

Those threads are the threadpool of node, which the file system work and the look up of host names (like `localhost` of a proxied server) use as well.
Node starts 4 threads, set `UV_THREADPOOL_SIZE` in the environment of the server for more (up to 1024): it is read when the threadpool starts, so it has to be set
before the process starts. `concurrency` caps how many responses of the whole server (all its virtual hosts) are compressed at the same time, so that a burst of compressed responses does not
make the reads of files wait. The ones over the cap are sent as they are, and a streamed response holds its place until it ends. There is no cap by default (0).

### Routes

A `worker` server finds the worker of a request in the files under `root`. `routes` in its options name the worker of some paths instead, without asking the file system, and the workers may live outside of `root`:

```javascript
{
  hostname: 'web.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: '/path/to/files',
    routes: [
      { path: '/health', worker: 'workers/health.js' },
      { pattern: '/items/(?<id>[0-9]+)', worker: '/srv/app/items.js' }, // event.pathParameters is { id: '12' } for /items/12
    ],
    fallthrough: false, // answer 404 for what matches no route, instead of looking under root
  },
}
```

The first route that matches the path wins, and a pattern has to match the whole path. A configuration with a route that is not valid (a missing worker, a broken pattern) stops the server from starting.
The patterns run in the front process for every request, so keep them simple. See the README of `@koeroesi86/node-worker-express` for the details.

### HTTP/2

The https port serves HTTP/1.1 only. Switch HTTP/2 on in the top level of the configuration, next to the ports:

```javascript
{
  portHttps: 443,
  http2: true, // off by default
  servers: [{ hostname: 'web.localhost', protocol: 'https', key: '/path/to/privkey.pem', cert: '/path/to/cert.pem', type: 'worker', options: { root: '/path/to/files' } }],
}
```

Clients that offer `h2` during the TLS handshake get HTTP/2, the others keep getting HTTP/1.1 on the same port, and so do websockets, which stay on HTTP/1.1. The plain http port is not affected.
The same servers answer both, they are set up once: a worker pool is not started twice. What differs for a handler is that the `host` header is the authority of the request, and that the pseudo headers (`:path`, `:authority`, ...) are not among the headers.
Headers that only HTTP/1 has (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`) are dropped from the responses of HTTP/2, as the protocol does not allow them. An idle connection is closed after `keepAliveTimeout`.

Express 4 builds its requests and responses on the classes of HTTP/1, which the objects of HTTP/2 are not, so the requests of HTTP/2 go to a second express app with the same methods on top of the classes of HTTP/2 (`src/request/create-http2-app.ts`).
A certificate is needed for every host, a handshake for a host without one is refused.

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
- The worker holds a request for as long as the upload takes. `limitResponseTimeout` counts from the last part that moved, a stalled upload is answered with 504 after it. A request whose connection was handed to the worker (`handOffRequests`) gets the 504 from the worker when nothing moved on the connection for that long and nothing was written yet; a client that keeps sending does not time out.
- The `lambda` server type reads the whole body into memory first and passes it to the lambda as `body` (see Lambdas below).

### Websockets

A worker answers the upgrade and is called for every message, see the README of `@koeroesi86/node-worker-express`. The server reads the frames (messages in pieces, UTF-8 text, binary, ping, close), holds the client back while the worker is behind,
and holds the worker back (`await callback({ sendWsMessage: true, frame })`) while the client is behind. These options of the server limit them: `limitWebSocketMessage` (bytes, 1 MiB), `limitWebSocketConnections` (per worker file, 1000),
`webSocketPingInterval` (30000 ms) and `limitWebSocketIdleTimeout` (90000 ms). Websockets of `proxy` servers are passed on to their target, so are the ones of `child` servers.

### Proxy servers

A server of the type `proxy` passes the requests of its host on to an application that runs on its own, websockets included: a fixed `target`, or one that the application registers itself, like a dyndns update.

```javascript
// a fixed target, for example to put an address you own in front of a provider
{
  hostname: 'api.localhost',
  protocol: 'https',
  type: 'proxy',
  proxyOptions: {
    target: 'https://my-service.cloud-provider.example',
    changeOrigin: true, // the Host header (and the TLS server name) of the target, not the one of the client
    hideHeaders: ['server', 'x-powered-by'], // headers of the response that give the provider away
    // secure: false, to skip the check of the certificate of the target, ca: '/path/to/ca.pem' for an internal authority
    // proxyTimeout: 60000, how long the target may stay silent
    // forwardedHeaders: 'sanitize' | 'pass' | 'none', see "Client address and forwarding headers"
  },
}

// a dynamic target, which the application behind it sets
{
  hostname: 'app.localhost',
  protocol: 'https',
  type: 'proxy',
  proxyOptions: {
    dynamic: {
      tokenEnv: 'APP_PROXY_TOKEN', // the environment variable that holds the token of this host (or token: '...')
      ttl: 300, // seconds after which a target that was not set again expires, no expiry by default
      // port: 8080, the port of a target registered without one
      // protocol: 'http', of a target registered without one
      // controlPath: '/.well-known/node-webserver/proxy'
      // allowPrivate: false, see below
      // persistPath: '/var/lib/node-webserver/app.json', to keep the target over a restart
    },
  },
}
```

A request is answered with 503 while there is no target (not registered yet, removed, or expired), 502 when the target cannot be reached and 504 when it stays silent for `proxyTimeout` (60 seconds).
The request to the target is aborted when the client goes away. The connections to a target are kept open between requests. Requests in flight when the target changes finish on the old one, new ones go to the new one.

#### Registering a dynamic target

The host answers one path itself, `/.well-known/node-webserver/proxy` (`controlPath`), which never reaches the target. Pick another one if the application uses it. With the token of the host in `Authorization: Bearer <token>`:

| | |
| --- | --- |
| `PUT` | sets the target. `{ "port": 8080 }` registers the address the request comes from (as `myip` does for dyndns) with that port, `{}` with the `port` of the configuration, `{ "target": "http://203.0.113.7:8080" }` an address of your choice. Answers the target, when it was set and when it expires |
| `GET` | the target, or 404 when there is none |
| `DELETE` | removes the target, 204 |

```sh
curl -X PUT https://app.example.com/.well-known/node-webserver/proxy -H "Authorization: Bearer $APP_PROXY_TOKEN" -d '{"port":8080}'
```

With a `ttl`, the application sends the same request again before it runs out, as a heartbeat. A target that is not refreshed expires, instead of reaching whoever gets the old address next.
With `persistPath` the target is written to that file and read from it at the start, and still expires by its `ttl`. Without it a restart starts without a target, until the application registers again.

Behind a primary ([front processes](#front-processes)) the front that takes a registration tells the primary, which writes `persistPath` and tells every front before the request is answered, a front that starts later too.
So a target stays when fronts are replaced, without `persistPath` as well, and is lost by a restart of the whole server only.

Security, as the proxy takes its target from a caller on the internet:
- **The token is the only protection of the control path.** It is per host, compared in constant time, and never logged (`Authorization` is left out of the access logs).
  The control path only accepts requests over HTTPS: on an `http` host only the ones a trusted proxy received over HTTPS (`X-Forwarded-Proto`), and the server warns at the start for such a host.
  An address that fails 10 times in a minute is refused for the rest of the minute, and a host takes 10 updates a minute, both counted by each [front process](#front-processes) for itself: with four of them it is up to four times as many.
- **A target is an IP address, http or https, and a public one.** Names are refused, as what they resolve to can change after the check. Loopback, private, shared (100.64.0.0/10), link-local (the metadata service 169.254.169.254 included),
  multicast and unspecified addresses are refused unless the host sets `allowPrivate: true`, for a LAN.
- The address of the caller is the one described below, so it cannot be spoofed with a header. Behind a load balancer that is not in `trustedProxies` it is the address of the load balancer, which is private and refused: the registration fails instead of pointing somewhere wrong.
- Other requests are passed on with their `Authorization` header untouched, only the control path takes the token.

#### Client address and forwarding headers

Forwarding headers (`X-Forwarded-For`, `-Proto`, `-Host`) are believed only from the load balancers listed in `trustedProxies`, in the top level of the configuration: CIDRs and `loopback`, `linklocal`, `uniquelocal`, for both servers,
or `{ http: [...], https: [...] }` per server. Nobody is trusted by default. It decides the client address of the control path, `req.ip` and `req.protocol`, and what a `proxy` server forwards (`forwardedHeaders`):

| Request | Client address | `X-Forwarded-For` sent to the target (`sanitize`, the default) |
| --- | --- | --- |
| a client, with a made up `X-Forwarded-For: 1.2.3.4` | the address of the connection | replaced by the address of the connection, `-Proto` and `-Host` from the connection, `X-Real-IP`, `X-Client-IP` and `CF-Connecting-IP` removed |
| a trusted load balancer, chain `client, lb` | `client`, the first address from the right that is not trusted | `client, lb, <load balancer>`, `-Proto` and `-Host` kept |
| a load balancer that is not in `trustedProxies` | the address of the load balancer | replaced by the address of the load balancer |

`forwardedHeaders: 'pass'` sends the headers of the client untouched, for a target that needs the original chain (it can be spoofed if the target trusts it blindly), `'none'` sends no forwarding headers at all.
The client address workers get (`remoteAddress`) does not follow `trustedProxies` yet.

### Metrics for workers

A worker can ask the server how it is doing with `event.getMetrics()`, which makes it easy to add a health or metrics endpoint. The server and the workers are different processes, so this is a question over the channel to the server,
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
| `front`, `fronts` | with [several front processes](#front-processes) only (below) |
| `sources` | `workers:<host name>` for each worker server (`workers`, `active` requests, `waiting` requests, `refused`, `failing`, the worker files that crashed in a row, the same per worker file under `paths`, and `latencyMs` per worker file), `lambdas` (`lambdas`, `busy`, `starting`, `waiting` requests, `abandoned` requests, per file), `connections:http` and `connections:https` (`open`, `dropped`, the settings) |

`latencyMs` is a histogram of the time from the request to the close of its response: `count`, `sumMs`, `maxMs`, the number of requests in each of fixed buckets (`buckets`, by their upper bound in milliseconds from `1` to `30000`, and `+Inf`,
not cumulative), and `p50`, `p90` and `p99`, which are the upper bound of the bucket they fall into. Counting a request only adds to numbers that exist, so it costs no memory per request. Per worker server it is kept by worker file,
the static files under the static worker, and the first 100 worker files get one each, the others share `(other)`, so a client that asks for many different paths cannot grow the metrics. A websocket counts until its upgrade is answered, not for as long as it stays open.

With [several front processes](#front-processes) the numbers on top are the ones of the front that runs the worker, `front` is its number (counted from 1, as in the logs), and `fronts` holds the numbers of every front by that number,
its own included. They are labelled and not added up, as percentiles, the event loop delay and the sources a program registers cannot be: a scraper sums the counters it needs. The front asks the primary, which asks every front,
so a question costs a round of messages; a front that does not answer within a second is left out, and while the fronts are replaced only the ones of the same set are asked.

`examples/health/exampleWorker.js` is a worker with `/health` (200, or 503 while requests wait for a worker) and `/metrics`. Mind that a health endpoint is a worker like the others: it is reachable by anyone who can reach its host name.
Part of the numbers are counted since the server started, a scraper computes rates from them. The existing stats domain (`statsDomain`) reports CPU and memory per process, with several fronts also `front`, the one that answers, and `fronts`, the usage of every front process by its number.
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

A `lambda` server runs an AWS Lambda handler behind API Gateway (a REST API with the proxy integration), each lambda in a process of its own that answers one request at a time. It is meant as a drop-in for it: the event, the context, the handler styles
and the answers to failures are the ones of AWS, and the differences are listed below. `lambdaOptions.lambda` is the file, `handler` the export (`handler` by default, a nested one like `controllers.users.get` works), the file can be CommonJS or an ES module with top-level await.

```javascript
exports.handler = async (event, context) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: event.httpMethod, body: event.body }) });
```

| option of `lambdaOptions` | |
| --- | --- |
| `limit` | how many lambdas the server may run, the number of CPU cores by default, 0 for no limit. Every lambda server has a limit of its own, and the worker servers have theirs: a configuration with several of them can run up to the sum of their limits as processes. With `routes` it is the default limit of every route, see Routes of lambdas below. |
| `routes` | several lambdas, or several handlers of one file, on one server, chosen by the path, see Routes of lambdas below |
| `acquireTimeout` | how long a request waits for a lambda when all of them are busy and the limit is reached, 10000 ms by default, then it is answered with 503 |
| `startTimeout` | how long a lambda may take to load its module and start, 10000 ms by default (the init timeout of AWS), then it is stopped and the request is answered with 502 |
| `timeout` | how long the handler may take to answer, 900000 ms (15 minutes) by default, then the lambda is stopped and the request is answered with 504. `context.getRemainingTimeInMillis()` counts down to it. |
| `limitRequestBody` | the largest body of a request in bytes, 6291456 (6 MiB, the payload limit of AWS) by default, 0 for no limit. Larger ones are answered with 413. |
| `restrictFileSystem` | whether a lambda can only write to its own folder, true by default, see Storage below |
| `env` | variables for the lambdas. They do not get the environment of the server, only what node needs (`PATH`, `HOME`, `TZ`, `NODE_OPTIONS`, the proxies, ...) and what AWS sets for a function (`AWS_LAMBDA_FUNCTION_NAME`, `AWS_LAMBDA_FUNCTION_VERSION`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, `AWS_LAMBDA_LOG_GROUP_NAME`, `AWS_LAMBDA_LOG_STREAM_NAME`, `AWS_EXECUTION_ENV`, `LAMBDA_TASK_ROOT`, `_HANDLER`) |

**Routes of lambdas.** One server can host several lambdas instead of one server (with a port or a virtual host) for each. `routes` is a list in the order of precedence, and the first one that matches the path wins, a path or a pattern alike:

```javascript
{
  hostname: 'api.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: {
    routes: [
      { path: '/orders', lambda: '/srv/api/orders.js', handler: 'list' },
      { pattern: '/orders/(?<id>[0-9]+)', lambda: '/srv/api/orders.js', handler: 'get', limit: 2 }, // event.pathParameters is { id: '12' } for /orders/12
      { pattern: '/users/.*', lambda: '/srv/api/users.js' }, // handler: 'handler'
    ],
  },
}
```

A route is a `path` (as it is) or a `pattern` (a regular expression for the whole path, anchored at both ends, with the optional `flags` `i`, `s`, `u` or `v`), the `lambda` file, and optionally the `handler` (`handler` by default) and a `limit`. The matching rules are the ones of the routes of a worker server above: the path
without the query, nothing longer than 2048 characters matches, and the patterns run in the front process for every request, so they are trusted configuration to keep simple. A route is not valid, and the server does not start, when it has no lambda, when its lambda is not a file, or when its pattern or flags are wrong.
The lambda and the handler are the ones in the configuration, they are never made from the request.

* The request is matched before a lambda is taken, so a path that no route matches is answered with 404 (`{"message":"Not Found"}`) by the front process, and no lambda is started for it. `lambda` and `handler` next to `routes` keep their meaning, as the route for every path that none of the others matches, and the server only answers 404 when they are not set.
* The named groups of a pattern are the `pathParameters` of the event. A route without named groups leaves them as they are for a server without routes (`{ proxy }`).
* The `limit` is per route, `limit` of the server when the route has none: a route has lambdas of its own, never waits for the lambdas of another and never has them stopped for it. Routes with the same lambda and handler are different pools, too. The processes of a server are at most the number of its routes times the limit, so with a limit of
  the number of CPU cores and several routes that is more than a server without routes. Set the `limit` of a route to what it needs. `acquireTimeout`, `startTimeout`, `timeout`, `limitRequestBody`, `restrictFileSystem` and `env` are the same for all routes.
* `lambdas` in the metrics lists the lambdas per file, with the routes of one file together.

**Event and context.** The event is the one of the proxy integration (payload format 1.0): `resource`, `path`, `httpMethod`, `headers` (the names as the client wrote them, the last value of a repeated one), `multiValueHeaders`, `queryStringParameters`
(the last value of a repeated parameter, `null` when there are none), `multiValueQueryStringParameters`, `pathParameters` (`{ proxy }`, or the named groups of the pattern of a route), `stageVariables` (`null`), `requestContext`, and `body` with `isBase64Encoded`. The body is `null` for a request without one,
the text when it is valid UTF-8, otherwise base64. The lambda is a worker of the worker pool (`@koeroesi86/node-worker/pool`): the body is streamed to it while it arrives, as to the workers of a worker server, and the handler runs once the whole body is there, so a lambda is held by a slow upload
(a client that goes away halfway lets go of it) and the 413 for a body over the limit also comes while it is read, not only when `Content-Length` says it. The context has `awsRequestId` (the `requestContext.requestId` of the event), `functionName`, `functionVersion`, `invokedFunctionArn`, `memoryLimitInMB`, `logGroupName`, `logStreamName`,
`getRemainingTimeInMillis()` and the old `done`, `succeed` and `fail`. A handler answers with the promise it returns (`async`) or with the callback, whichever comes first. A response has `statusCode`, `headers`, `multiValueHeaders`, `cookies`, `body` and `isBase64Encoded`.

**Waiting.** Requests that find all lambdas busy wait in line, the one that came first is served first, and are woken as soon as a lambda is free or one exits, nothing polls. A request whose client goes away while it waits leaves the line without taking a lambda
(`abandoned` in the metrics counts them, `waiting` is the length of the line).

**Failures** are answered the way API Gateway answers them, with a JSON object with a `message`: a handler that fails (an error to the callback, a rejection or a throw), a response without a valid `statusCode` or with a `body` that is not a string, a lambda that does not start
or exits during the request give 502 `{"message":"Internal server error"}`, the error goes to the log. A handler that takes longer than `timeout` gives 504 `{"message":"Endpoint request timed out"}`, a full line 503 `{"message":"Service Unavailable"}`
and a body that is too large 413 `{"message":"Request Entity Too Large"}`.

**Storage and lifespan.** Every lambda process has a folder of its own in the temporary folder of the system, and `TMPDIR`, `TMP` and `TEMP` point at its `tmp` folder, so `os.tmpdir()` is what `/tmp` is on AWS: it is kept for as long as the lambda runs (across
invocations), is not shared with another lambda, and is removed when the lambda exits. By default a lambda can write nowhere else (the code is read-only like on AWS), which is the permission model of node (`--permission`), so it needs a node that has it, and
child processes, workers and addons are allowed as they are on AWS. It does not restrict the network, and it is not a security boundary against native code. The path `/tmp` itself is not the folder, a handler that hardcodes it is refused. The 512 MB of AWS are not enforced.
The request and the response travel over the channel to the worker, as bytes, without a store in between. A lambda is not handed out any more 14 minutes and 30 seconds after it started and is stopped (`SIGTERM`, `SIGKILL` after 5 seconds) when it is idle,
a request that runs on it finishes first, up to `timeout`; a replacement starts when the next request needs one. The folders of a server that was killed are removed by the next server that starts.

**Differences from AWS** that stay: one request per lambda process at a time, like AWS, but it queues instead of scaling out and answering 429; the callback ends the invocation without waiting for the event loop to empty
(`callbackWaitsForEmptyEventLoop` is only there); the response has no size limit; the processes share the host, the user and the network, only the writes to the file system are restricted; there is no frozen environment between invocations;
only the event of API Gateway is supported (no other event source, no payload format 2.0 for the request); `requestContext` has the identity of the caller and the request only, and `stageVariables` are never set.

### Idle workers and the limit for all servers

A worker that has had no request for `limitWorkerIdleTimeout` (5 minutes by default, 0 to keep them) is stopped, and the next request for its file starts one again, so that files that were asked for once do not keep a process each.
`workerLimit` in the top level of the configuration (0 by default, for no limit) is the number of worker processes that all the worker servers may run together, next to the `limit` of each server.
When either is used up and a file has no worker, an idle worker is stopped to make room for it: a second worker of a file before the last one, and the one that has been idle longest first.
The last worker of a file is only taken while it has no request, so a busy file cannot starve the others. `evicted` in the metrics of a worker pool counts the workers stopped for being idle (`idle`) and to make room (`forRoom`),
and the `workers` metrics show the processes of all the servers against `workerLimit`.

### Warm workers

The first request to a worker file waits for its process to start and load the module. `warmPaths` in the `options` of a worker server lists request paths (`['/', '/api/']`) whose worker file is started with the server, and started again
whenever it has fewer than `warmWorkersPerPath` workers (1 by default, at most `limitPerPath`): after a worker crashed, or was stopped to make room for another file. The idle timeout (`limitWorkerIdleTimeout`) does not stop the workers
a file is kept warm with. They count towards `limit` and `workerLimit`, and requests that wait for a worker come first, so they only take room that nothing else needs: a file with no worker can still make room by stopping an idle warm worker,
which starts again when there is room. A file whose workers keep crashing is tried again when its backoff is over. The static worker is started with the server
unless `warmStaticWorker` is `false`.

The static worker answers range requests, and `options.static` sets `Cache-Control` per folder or extension, lists folders (`listDirectories`) and serves `.br` / `.gz` files that exist next to a file (`precompressed`): see "Static files" in the README of `@koeroesi86/node-worker-express`.

### Workers that crash

A worker that stops with an error, or at all within 5 seconds of starting, has crashed. The first crash is answered by starting another worker for the next request, as before.
After the second one in a row the server stops starting workers for that path for a while, 100 milliseconds at first and twice as long after every further crash up to 10 seconds, instead of starting a process for every request.
Requests that arrive in the meantime are answered with 503 and a `Retry-After`, unless a worker for the path is still running, which takes them. A worker that stays up for 5 seconds clears the count.
`failing` in the metrics lists the paths that are held back, with their crashes and the time left. Workers the server stops itself (an idle one that makes room, the shutdown) are no crash.

What a worker writes to its stdout and stderr is handed to `onStdout` and `onStderr` from the moment it starts.

### HTTPS

A server with `protocol: 'https'` is served on the https port for its host name (SNI), with the files in `key`, `cert` and, for the chain, `ca` (paths to PEM files).
A host name with a wildcard (`*.example.com`, `*` is one label) gets its certificate for every name it matches, found like the virtual hosts are: an exact name first, then the wildcards in the order of the configuration.
A client that asks for a name without a certificate, or sends none, fails the handshake at once.

#### Redirecting http to https and HSTS

Nothing sends a client from the http port to the https one unless the https server asks for it:

```javascript
{
  hostname: 'secure.example.com',
  protocol: 'https',
  key: '/etc/ssl/secure.example.com/privkey.pem',
  cert: '/etc/ssl/secure.example.com/fullchain.pem',
  redirectHttp: true, // or { status: 301 }
  hsts: true, // or { maxAge: 31536000, includeSubDomains: true, preload: true }
  type: 'worker',
  options: { root: '/path/to/files' },
}
```

- `redirectHttp` answers the plain http requests for the host name with `308` (the method and the body of the request are kept; `{ status: 301 }` is for old clients) to the same path and query on https,
  on the name the client asked for (a wildcard host redirects each name it matches) and with the https port when it is not 443. It costs a lookup in the host table of the http port, like any other http server. The redirect comes after the servers
  on the http port: an `http` server of the same name that is in the configuration answers first, and the redirect gets the requests it passes on.
- `hsts` sends `Strict-Transport-Security` with the responses of the server, `max-age` a year (31536000) unless `maxAge` says otherwise. The browsers then keep to https for the host without asking the http port first.
  `includeSubDomains` and `preload` are off: both reach beyond this host and are hard to take back (a browser keeps the host in the list for as long as `maxAge`, and a preload list for months), so switch them on only when every subdomain can be served on https.
  Start with a short `maxAge` while trying it out.
- Both are for `https` servers only, the configuration check fails for an `http` server that sets them.

#### Redirects and rewrites

`rules` on a server is a list that runs before the server of the host, in front of its compression and after HSTS, so a redirect carries the header. A host without `rules` does nothing for them.

```javascript
{
  hostname: 'www.example.com',
  protocol: 'http',
  type: 'worker',
  options: { root: '/path/to/files' },
  rules: [
    { path: '/old', redirect: '/new', status: 301 },
    { pattern: '/blog/(?<year>[0-9]{4})/(?<slug>.+)', redirect: '/posts/{slug}-{year}', status: 308 },
    { pattern: '/(?<rest>.*)', redirect: 'https://example.com/{rest}', status: 301, methods: ['GET', 'HEAD'] },
    { pattern: '/app/.*', rewrite: '/index.html' },
  ],
}
```

- A rule has `path` (the whole path) or `pattern` (a regular expression for the whole path, `flags` as in the route tables of the workers and lambdas, so there is one implementation and the same checks), and either `redirect` with a `status` of 301, 302, 307 or 308 (required: no default
  makes a client cache a permanent redirect by accident), or `rewrite`, the path the server of the host gets instead.
- The first rule that matches decides, once: the path a rewrite makes is not matched against the rules again. A path is matched as the client wrote it (without the query, not decoded). `methods` limits a rule to some methods (all when left out), and a request
  of another method goes on to the next rule. The query of the request is added to a redirect target unless `keepQuery: false`, and is always kept by a rewrite. The original url stays for the access log.
- A target is a path of the host, or (redirect only) an absolute URL. `{name}` in it is the named group of the pattern of that name, as the request wrote it, with a backslash and what is not printable ASCII encoded (`%5C`): the configuration check fails for a name that
  is no group of the pattern.
- A request cannot redirect to a host of its choosing. The scheme and host name of an absolute target are the ones written in the configuration (a capture can only come after them), a path target has to start with a single `/`, and a result that does not (the request was
  `//evil.com` and the target `/{rest}`) is answered with `400` and not followed. The check of the configuration refuses a target that could do it.
- `301` and `302` let a client turn a `POST` into a `GET`: the check warns when a rule with such a status names a method other than `GET` and `HEAD`. Use `307` or `308` to keep the method.
- The rules run on the front process for every request of the host, so patterns are trusted configuration: avoid ones that backtrack, like nested repetitions (the limit on the length of a path is the one of the route tables). The rules without `methods` next to each other
  share one table, so a path costs a lookup in a map and the patterns before it, not a test of every rule.

#### Error pages

`errorPages` on a server maps a status code from 400 to 599 to a file, and answers that status of the host with the file instead of the body it had, like `error_page` of nginx. The files are read when the server starts and on reload (a changed file loads the servers again), and the check fails for a file that is not there.

```js
{
  hostname: 'example.com',
  protocol: 'https',
  type: 'worker',
  options: { root: '/srv/example' },
  errorPages: { 404: '/srv/pages/404.html', 502: '/srv/pages/down.html', 503: '/srv/pages/down.html' },
}
```

- It replaces by status, on the front process, for the answers of the lambdas, the worker pool, the proxy and the front itself (404, 413, 502, 503, 504): at that point an answer of a worker or a proxied app with the same status looks the same, so it is replaced as well. An answer that is `text/html` already is left as it is, so a worker or an app that sends a page of its own for its 404 keeps it. Note that `res.send('text')` of Express is `text/html`.
- The type of the page comes from the extension (`.html` and `.htm` are html, `.json` is JSON, anything else is plain text). The other headers of the answer stay (`Retry-After`, cookies), those of its body (`Content-Type`, `Content-Length`, `ETag` and the like) go.
- It sits inside the compression and outside the server, so a page over the threshold is compressed. A host without `errorPages` does nothing for it, and a request with another status passes through untouched.

#### Default host

`defaultHost: true` on a server makes it answer the requests of its protocol that no server takes, like `default_server` of nginx: a host name that matches no server (no exact name, no wildcard), a request without a `Host` header,
and a request that the matching servers passed on. It is tried last, after the redirects to https, and the host name of the server itself still works as before. There is at most one per protocol (the configuration check fails for a second one),
and the http and https ports each have their own. Without one, a request for a host name that no server takes, or without a `Host` header, gets a plain `421 Misdirected Request` (`text/plain`, written by the front process). `errorPages` do not apply, as no server holds them: `unknownHostPage` at the top level of the configuration, a file, answers these requests with its content instead (type by the extension, as for `errorPages`; read when the server starts and on reload, a changed file loads the servers again, and the check fails for a file that is not there). A request that a matching server passed on still gets the `404` of Express. The lookup costs nothing for the requests a server takes.

#### Certificates from Let's Encrypt

`acme` on an `https` server gets its certificate from an ACME server (Let's Encrypt unless `directory` says another), keeps it on disk and renews it:

```javascript
{
  hostname: 'secure.example.com',
  protocol: 'https',
  redirectHttp: true,
  hsts: true,
  acme: {
    email: 'admin@example.com',
    storagePath: '/var/lib/node-webserver/acme', // the account key and the certificates, must be writable
    // directory: 'https://acme-staging-v02.api.letsencrypt.org/directory', // try it on the staging directory first
    // renewBeforeDays: 30, // by default once a third of the lifetime of the certificate is left
  },
  type: 'worker',
  options: { root: '/path/to/files' },
}
```

- Setting `acme` means you agree to the terms of service of the certificate authority, which the server tells it when it makes the account (`email` is where the authority writes to).
- `key` and `cert` are not needed. The key and the certificate (with its chain) are written to `<storagePath>/<hostname>/privkey.pem` and `fullchain.pem`, or to the files `key` and `cert` name.
  The account key is `account-<hash of the directory>.pem` in `storagePath`. Keep the folder: it is what the server finds its certificates in after a restart, and the authority limits how many it issues for a name per week.
- The server looks at the certificates when it has started and then every hour. A server without a certificate gets one, a server whose certificate has a third of its lifetime left (`renewBeforeDays` days, if set) gets a new one with a new key
  (P-256). A certificate is replaced as a reload does it, see [Reloading the servers](#reloading-the-servers): new connections get the new certificate, the open ones keep theirs. Until the first certificate is issued the handshakes for the name fail, as they do for a name without one.
  An order that fails (the authority cannot reach the server, a limit) is logged and tried again an hour later, and the certificate that is there stays in use.
- The authority proves the host name with the `http-01` challenge, which it sends to **port 80** of the host name: `portHttp` has to be that port, or the port 80 of the machine has to lead to it. The challenge is answered on the http port before the virtual hosts,
  so it works while `redirectHttp` is on. A name needs to resolve to the server and to be one the authority issues for (not `localhost`, not a private address).
- A host name with a wildcard (`*.example.com`) needs the `dns-01` challenge and a DNS provider, which this does not do: the configuration check fails for it, and it can still use certificate files that certbot or similar make.
- `directory` has to be an https URL. For a private ACME server such as [Pebble](https://github.com/letsencrypt/pebble), `directoryCa` is the file with the certificate its directory is checked against.
- Behind a primary ([front processes](#front-processes)) the primary alone orders and renews, for the servers its fronts run, and writes the logs of it. It tells every front the answer of a challenge before it asks the authority to check it,
  as the authority may reach any of them, and has all of them load a new certificate. A server that a change adds gets its certificate at once.
- The client is part of the server (the `https` and `crypto` modules of node, no ACME package): the account and the orders of RFC 8555 with `http-01` and ES256 keys. The work happens at start and on the hourly timer, none of it on the path of a request except the check of the http
  path for the challenge.

TLS ends in the front process, on the thread that serves every other request too, so a handshake slows all of them down a little, plain HTTP included. What keeps that small:

- **Use an ECDSA (P-256) certificate** where the clients allow it (every current browser does). Its handshakes are cheaper for the server than with RSA 2048: about 40% more of them per second,
  and less delay for the other requests while they run, see [the load test](../../tools/README.md#new-tls-connections). Certificate authorities, Let's Encrypt among them, issue both, for example `certbot --key-type ecdsa`. Self signed:

  ```sh
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 -subj "/CN=secure.localhost" \
    -addext "subjectAltName=DNS:secure.localhost" -keyout privkey.pem -out cert.pem
  ```

- **Session resumption** is on without any setting: a client that comes back resumes its session with a ticket, which skips the expensive part of the handshake. The keys of the tickets are made when the server starts, so a restart makes clients do full handshakes again.
- Clients that keep their connections (`keepAliveTimeout`, below) need no new handshakes at all.
- The cipher settings of `https.createServer` (`honorCipherOrder`, the order of the suites, `ecdhCurve`) made no measurable difference to the number of handshakes, so there is nothing to tune there. Only limiting the server to TLS 1.2 made them cheaper (about 15% more per second), which costs the clients that use TLS 1.3 their faster handshake: not worth it.
- Where many new connections are expected, end TLS in a reverse proxy or CDN in front of the server and let it talk plain HTTP to the server.

### Connections

`keepAliveTimeout` (milliseconds, default 65000) is how long the server keeps an idle connection of a client open. Node closes them after 5 seconds, which is shorter than what load balancers and proxies keep theirs for (60 seconds is common),
and a request that was sent over a connection that has just been closed fails. `maxConnections` (default 10000, 0 for no limit) is the number of open connections per server (http and https each) after which new ones are dropped,
which the `connections:*` metrics count. Both are in the top level of the configuration, next to the ports. With [several front processes](#front-processes) the connections are split between them.

### Front processes

The front (parsing, TLS, routing, the messages to the workers, compression, access logs) runs on one core of one process. `frontProcesses`, at the top level of the configuration as the ports are shared, runs more of them
with [`node:cluster`](https://nodejs.org/api/cluster.html): a number from 1 to the smaller of 4 and the available cores (anything above is an error), or `"auto"` for that maximum, which is the default. A single core runs one front.

**On a machine with several cores** the command line therefore runs more than one front unless the configuration says otherwise, which is worth it where the front was the limit and costs something everywhere else:
- processes and memory: every front is a Node.js process of its own, about 90 MB before its first request, with its own worker and lambda pools, caches and warm workers,
- the [limits](#front-processes) are split between the fronts, so one front can be full while another has room, and a path or a lambda that may run few processes has fewer fronts run,
- connections are handed over by the primary, and a long lived one (a websocket, HTTP/2) stays on its front,
- log files, metrics and the stats domain are per front, and code of the configuration (callbacks such as `onStdout`, what runs when it is loaded) runs in every front.

`frontProcesses: 1` runs one front, as before this was the default. Measure which is better: on a small machine the fronts compete with the workers for the same cores.

`nws-cli` starts them, as does `startCluster(configuration, logger?, { processHooks, configurationFile })` for a program; `startServer` always runs one front, in its own process, and warns when `frontProcesses` asks for more.

```javascript
const { startCluster } = require('@koeroesi86/node-webserver');

const { role, frontCount, reload, stop } = await startCluster(require('./configuration'), undefined, { configurationFile: require.resolve('./configuration') });
```

`startCluster` always makes the process a primary, also for one front: the primary owns the ports, supervises the fronts and serves nothing itself. With `frontProcesses` of one the front accepts the connections itself. When it asks for more, the primary accepts them and hands them to the fronts in turn,
also when a limit brings them down to one. On Windows the primary does that for one front too: a front that accepts itself would take a connection with it when it stops listening, and could not be
[replaced without a failed request](#changes-of-the-configuration).
Every front is the same script run again with the same arguments, in which `startCluster` serves instead, and so is the process that looks at a changed configuration, so what comes before the call runs in each of them too.
It resolves once all fronts serve, and rejects when one does not start (a problem of the configuration, a port in use), which stops the others. `role` is `primary` or `front`; `reload` and `stop` of the primary act on every front,
`reload` of a front asks the primary for it, `stop` of a front stops that one.

**What is shared and what is not.** Each front is a server of its own: its own worker and lambda pools (a path that has a worker in one front starts another one in the next), caches and metrics, which `event.getMetrics()` and the
[stats domain](#metrics-for-workers) show for every front. The [registered targets](#registering-a-dynamic-target) of `proxy` servers and the applications of `child` servers are the same for all of them. A connection stays on its front for as long as it is open, websockets and HTTP/2 sessions included.

**Limits** are the totals of the server, split between the fronts as evenly as possible (6 over 4 fronts: 2, 2, 1, 1): `workerLimit`, `maxConnections`, `limit` and `limitPerPath` of a worker server, `limit` of a lambda server and its routes,
their defaults included. No more fronts run than the smallest limit that is set allows, without a message about it: with `limit: 2` on one lambda route there are 2 fronts at most, with a limit of 1 there is one, behind the primary.
`limitPerPath` as a function is the exception, every front gets at least 1 of what it returns, so the total can be higher. Per front, and not split: the `concurrency` of the compression, `limitQueue`, `limitWebSocketConnections`, the rate limits of the control path of a dynamic target, and the workers
of `warmPaths` (`warmWorkersPerPath` in every front, within its share of the limits). The connections are spread, not the requests: a front can be full while another has room, so requests wait, or get a 503, earlier than with one front.
A connection over the share of `maxConnections` of a front is closed, also while another front has room, which long lived connections can lead to.

**`child` servers** have one application each, whatever the number of fronts: the primary starts it for the fronts that want it and stops it once none does, and when it ends itself. The fronts proxy to it.
- Without `proxyOptions.port` the primary picks a free port from `portLookup` (3000 to 3010 on `localhost` without it) for `%PORT%` and an `args` function, which every process that runs the server calls to tell one application from another,
  so it has to give the same arguments for the same port. A request that comes before the front was told the port waits for it, and fails with 500 when there is none left.
- The same server keeps its application, through a reload, a change of the configuration and a replaced front. A changed one (its definition or files) gets another application next to it, which with the same fixed `port` starts
  once the old one ended, so that requests fail with 502 in between.
- The primary writes what the applications write in its own logs, and an application that ends on its own is not started again.

**When a front ends** another one takes its place and its share, at once the first time, then after 100 ms doubling up to 10 s as long as they end within 5 seconds, like a [worker that crashes](#workers-that-crash). The others keep serving.
A connection the primary hands to a front in the instant it dies is not answered, and its client gives up on its own. A replacement that loads another configuration than the one the server runs, or finds another version of the package installed,
ends instead of serving, and the primary looks at the [change](#changes-of-the-configuration); with no front left and none to start the server ends with an error, which has a service manager start it again. A configuration that loads differently
every time (a value made while it is loaded) is not compared. When the primary dies, its fronts and their workers exit.

**Stopping** works as below. The primary passes `SIGINT`, `SIGTERM` and `SIGHUP` on to the fronts over the channel to them, as a signal to the primary alone does not reach them (and Windows would end them at once);
systemd and Ctrl+C signal every process, and a front takes the same signal from both as one. The primary ends once the fronts did, and kills the ones that are still there 2 seconds after `shutdownTimeout`. A launcher passes the signals on
to the primary in the same way, and ends the way the server ended.

**Reloading** happens in all fronts together. The primary alone watches the files, which the fronts name to it after every load, and loads no server itself. On a change, a `SIGHUP` with `reloadOnSighup` (also with `watchServers` off),
or `reload`, it asks every front to load the servers and to start what changed without serving it. Only when all of them did, and loaded the same, it tells them to serve it and retire the old servers. Otherwise every front keeps what it runs,
and the log says why: a file that cannot be loaded or a problem of a server is tried again at the next change, fronts that read a file while it was written are asked again at once, up to 3 times. One reload runs at a time, a change during one
starts another after it. A front that does not answer within 30 seconds is replaced. The fronts switch close to each other, not at the same instant, and while they do every front holds the old and the new workers, which takes more memory than with one front.
A front that replaces another one loads the files as they are then; once it serves, all fronts are asked to load again, so that they run the same. While it cannot load them it is tried again with the delays above, and the others serve.
A change of a limit that changes the number of fronts starts [new fronts](#changes-of-the-configuration).

**Logs.** Each front writes files of its own, `<start>.front-<n>.<level>.log`, and puts `[front-<n>]` in front of its lines, also when there is one front. The primary logs the fronts it starts, loses and replaces, in files of its own:
`<start>.primary.<level>.log` with the logger `startCluster` makes, or where the logger it is given writes. It keeps the settings of the logs it started with.

### Reloading the servers

The servers are loaded again when their files change, while the server keeps running. For a server given as a path in `servers` the files that are watched are the file of the server, the local files it loads
(not the packages under `node_modules`) and its `key`, `cert` and `ca`. A file in `servers` that does not exist yet is watched too, and started once it is created. A server written directly in the configuration is loaded again when
the files of its workers or lambdas change (below); its definition itself stays the one the server was given.
The paths a `worker` or `lambda` server is given are watched and part of the check for a change, as they run in other processes and are not among the files the server file loaded: `options.root`, the `worker` of the routes, the files under the `root` named in `options.index` (the workers that a request finds without a route, not those in `node_modules`),
`options.staticWorker`, `lambdaOptions.lambda` and the `lambda` of the routes. Of a `root` the real path is checked, not the files under it. The index files are looked for when the server is loaded:
one that is added in a folder that has none is found at the next reload, not by the watch. A change of only a module that a worker or a lambda imports is not noticed, unless a deploy makes a link on the way to a watched path point elsewhere:
its processes keep the module they loaded until they are stopped.

- A link on the way to a watched file is followed: when it is made to point to another folder (`ln -sfn` and `mv -T`, the way a deploy switches releases), the servers under it are loaded again, and the old ones finish their requests
  as described below. Keep at least two releases on disk: a draining worker can still load files from the old one for up to 30 seconds. The folder that holds the link is watched, and only the name of the link and the watched files report a change.

- The writes that come within 100 milliseconds of each other are one change, as an editor can write a file several times when it saves it.
- Everything is loaded and checked before anything changes. A file that cannot be loaded, or a server with a problem the [check](#checking-the-configuration) reports (a syntax error, a server without a `hostname` or `protocol`, a certificate that cannot be read, a server that fails to start) is logged,
  and the servers keep running as they were.
- A server whose files did not change keeps running as it is, with its workers, lambdas and child process. Its certificates are read again, so a renewed certificate is used for the new connections.
- A server that was changed or removed takes no new requests. The requests it has already taken are answered by it, and its workers and child process are stopped once they are, or after 30 seconds,
  whichever comes first, which is what ends a websocket that stays open longer. Its idle lambdas are stopped at once, and the busy ones once they answered. A `proxy` server closes its connections
  to the target once the requests on them are answered, a websocket through it stays open until one of its ends closes it. A changed server is started anew next to it: a `child` server with a fixed
  `port` in its `proxyOptions` cannot start while the old one still has it.
- A `proxy` server with a `dynamic` target keeps the target that was registered with it when its file changes, as long as its `hostname` and `protocol` stay the same, so the service behind it does not
  have to register again (its `ttl` still counts from the last registration).
- The listening sockets stay open, so no connection is refused during a reload.
- With [several front processes](#front-processes) all of them load the servers again together.

`watchServers: false` in the configuration turns watching off, `reloadOnSighup: true` loads the servers again on `SIGHUP` instead of stopping, for deployments that prefer to say when.
A reload does not change the configuration itself (the list of `servers`, the definitions of the servers written in it rather than in a file of their own, the ports, `keepAliveTimeout`, `maxConnections`, the stats, the logging and
`frontProcesses`): a server started with `startServer` is given it once. `nws-cli` and `startCluster` with a `configurationFile` [apply its changes](#changes-of-the-configuration) with new front processes.

### Changes of the configuration

`nws-cli` (and `startCluster` with `configurationFile`, a file the script loads with `require` every time it runs) watches the configuration file and the local files it loads, unless `watchServers` is `false`. A change is first checked by a process
of its own, which loads the configuration and the server files anew: a configuration that cannot be loaded or has a [problem](#checking-the-configuration) is logged, and the server keeps running as it was. With `reloadOnSighup`, `SIGHUP`
applies a change too, also with `watchServers` off. A file that a change adds to the ones the configuration loads is watched once the change is applied, or was refused for a problem.

**Without a pause**, a new set of front processes is started next to the running one, and once all of them listen the old ones stop as described under [Stopping the server](#stopping-the-server): they take no new connections, finish the requests
in flight, close websockets with 1001 and are killed after `shutdownTimeout`. A set that does not start (a port in use) is dropped, and the old one keeps serving until the next change. The number of fronts is worked out anew, which a change of
a limit in a server file does too. While old and new fronts run side by side, **the limits can be exceeded** (each set has its own), and a connection can reach either. A connection that is kept open stays on its old front until its request in
flight is answered, then it is closed: a client that sends the next request in that instant has to send it again, as with any server that closes an idle connection.

**With a pause**, by a restart of the whole server through the launcher: new connections are refused while the requests in flight finish and the new server starts. That happens when
- `frontProcesses` changes between one front and several, as how connections are accepted is fixed once the first front started (not on Windows, where the primary always accepts them),
- [another version of the server](#updates-of-the-server) is installed.

There is no old server to go back to then, so a server that does not start after a restart (a port in use) is tried again, at once and then after 100 ms doubling up to 10 s, and the log says so.

**The launcher** is the process of `nws-cli`: it runs the command again as the server, starts it again when the server asks for that, passes `SIGINT`, `SIGTERM` and `SIGHUP` on, and otherwise ends the way the server ended, so a stop or a crash is
what it was without it. The command of an installed service stays the same. When the launcher is gone, the server and everything it started exit. Without a launcher (`startCluster` of a program) the changes that need a restart are logged and not
applied. The launcher itself is updated by a restart of the service only. `startServer` is never restarted.

Only the files are watched: a change of an environment variable that the configuration reads is not seen until something else changes it or the server is restarted, and the server keeps the environment it was started with.

#### Updates of the server

A server behind a launcher restarts into another version of itself once one is installed, unless `watchServers` is `false`. A version is the versions of `node-webserver-cli`, `node-webserver`, `node-lambda-invoke`, `node-worker-express`
and `node-worker` together, as they are found from the script the server runs. An update of another dependency alone is not seen. A `startCluster` of a program is told apart the same way, without the command line.

- Every 5 seconds the server reads the versions where the script it was started with leads **now**, links included, so both a package manager that writes over the installed packages and a deploy that points a link to a new release are seen.
- Another version is acted on once it was the same for about 10 seconds, as an update writes one package after the other. A process of its own then loads the **new** code with the configuration and checks it. While that fails (the update is not
  complete, the code does not load, the configuration has a [problem](#checking-the-configuration) for the new version) the old version keeps serving, and it is checked again after gaps that double up to 5 minutes.
- A version that passes restarts the server: the requests in flight finish, new connections are refused until the new server serves, and the primary is replaced too. The check does not listen on the ports, so a version that fails only there
  is tried again and again after the restart, with no way back to the old one.
- A package manager that writes over the installed packages changes the files of the running server under it, which can fail what it loads until it restarts. A release of its own behind a link does not.
- The launcher keeps its code until the service, or the command, is restarted. It starts the server by the path of the script it was started with, links included. The shims pnpm writes for the commands of a project run the file in its
  store, a path that names the version: the launcher, and `service add`, take the link the project has to the package then (`getStableScriptPath` of this package).

### Checking the configuration

The configuration is checked against `configuration.schema.json` of the package, and against what a schema cannot say, when the server starts and again on every reload, and the check can be run alone, without
listening or starting a worker, a lambda or a process: `nws-cli --config <path> --check` (or `checkConfiguration(configuration)` and `formatProblems(problems)` of this package, which return and write the problems).
It prints every problem with its server (the host name, and the file when the server comes from one) and its setting, and exits with 1 when there is an error, 0 otherwise (warnings are printed). It loads the server files, which runs them.

- the settings: a key that is not a setting (a typo such as `proxyOption`), a value of the wrong type or range, a missing required one (`options` of a `worker` server, `proxyOptions` of a `proxy` server, `childOptions`, `proxyOptions` and `serverOptions` of a `child` server)
- the files: `key`, `cert` and `ca`, `options.root`, `cwd`, `staticWorker` and the `worker` of the routes, the `lambda` of a lambda server and its routes, and `proxyOptions.ca` have to exist
- the certificates: an https server needs a key and a certificate, which have to belong together; a certificate that expired is an error, one that expires within 14 days a warning
- the routes: `pattern` has to be a regular expression with its `flags`
- the servers together: a host name served twice over the same protocol is an error, a host that is the `statsDomain` is a warning, and `portHttp` and `portHttps` cannot be the same
- `frontProcesses` above what the machine runs
- a `proxy` server has either a `target` that is a URL or a `dynamic` one with a token, a `child` server with arguments needs `%PORT%` in them unless `proxyOptions.port` is set, and a lambda server needs a `lambda` or `routes`

An error stops the start, with all the problems in the message, and on a reload it is what is logged while the running servers are kept. A server file that does not exist is a warning, as a reload leaves it out.
The schema is also for editors: `"$schema": "./node_modules/@koeroesi86/node-webserver/configuration.schema.json"` in a JSON configuration or server file gives completion and the same checks. Settings that take a function
(`onStdout`, `limitPerPath`, `args` as a function) have no JSON form, and are checked to be a function only.

### Stopping the server

On `SIGINT`, `SIGTERM` and `SIGHUP` (the last one only without `reloadOnSighup`) the server stops gracefully, as `nginx -s quit` does, so a deploy or a restart of the service does not cut the responses in flight:

1. It stops listening on both ports, and the responses on connections that stay open get `Connection: close` (HTTP/2 sessions are closed once their streams are done), so clients move on to another instance.
2. Websockets are closed with a close frame, code 1001 (going away), at once, as they would otherwise outlast every timeout. Idle keep-alive connections are closed, and so are the ones that become idle when their response is complete.
3. The requests in flight are answered. After `shutdownTimeout` (milliseconds, default 30000) the connections that are left are cut.
4. The workers, lambdas and child processes are stopped, once their requests are done or in the time that is left of the timeout, then the logs are written, the tmp folder is cleaned and the process ends with the signal, as before.

A second one of these signals ends the process at once, the way it ended before. So do an uncaught exception, `SIGUSR1` and `SIGUSR2`, as the state may be broken. `shutdownTimeout` is in the top level of the configuration, next to the ports.

### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
