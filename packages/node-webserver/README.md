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
  compression: true, // or { threshold: 512, level: 6, brotliQuality: 4, encodings: ['br', 'gzip'], concurrency: 4 }
  options: { root: '/path/to/files' },
}
```

Responses of text like types (text, JSON, JavaScript, XML, SVG, some fonts) are compressed with brotli, gzip or deflate, whichever the client accepts and likes most,
when they are at least `threshold` bytes (1024 by default) or of unknown size. Streamed responses stay streamed, as every part is flushed. The compression runs on the
threads of node, not on the one that serves the requests, but it still takes CPU: leave it to a reverse proxy or CDN if there is one in front of the server.

Those threads are the threadpool of node, which the file system work and the look up of host names (like `localhost` of a proxied server) use as well.
Node starts 4 threads, set `UV_THREADPOOL_SIZE` in the environment of the server for more (up to 1024): it is read when the threadpool starts, so it has to be set
before the process starts. `concurrency` caps how many responses of the whole process are compressed at the same time, so that a burst of compressed responses does not
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
- The `lambda` server type reads the whole body into memory first and passes it to the lambda as `body` (see Lambdas below).

### Websockets

A worker answers the upgrade and is called for every message, see the README of `@koeroesi86/node-worker-express`. The server reads the frames (messages in pieces, UTF-8 text, binary, ping, close), holds the client back while the worker is behind,
and holds the worker back (`await callback({ sendWsMessage: true, frame })`) while the client is behind. These options of the server limit them: `limitWebSocketMessage` (bytes, 1 MiB), `limitWebSocketConnections` (per worker file, 1000),
`webSocketPingInterval` (30000 ms) and `limitWebSocketIdleTimeout` (90000 ms). Websockets of `proxy` servers are passed on to their target, the ones of `child` servers are not proxied yet (see #56).

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

Security, as the proxy takes its target from a caller on the internet:
- **The token is the only protection of the control path.** It is per host, compared in constant time, and never logged (`Authorization` is left out of the access logs).
  The control path only accepts requests over HTTPS: on an `http` host only the ones a trusted proxy received over HTTPS (`X-Forwarded-Proto`), and the server warns at the start for such a host.
  An address that fails 10 times in a minute is refused for the rest of the minute, and a host takes 10 updates a minute.
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

A `lambda` server runs an AWS Lambda handler behind API Gateway (a REST API with the proxy integration), each lambda in a process of its own that answers one request at a time. It is meant as a drop-in for it: the event, the context, the handler styles
and the answers to failures are the ones of AWS, and the differences are listed below. `lambdaOptions.lambda` is the file, `handler` the export (`handler` by default, a nested one like `controllers.users.get` works), the file can be CommonJS or an ES module with top-level await.

```javascript
exports.handler = async (event, context) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: event.httpMethod, body: event.body }) });
```

| option of `lambdaOptions` | |
| --- | --- |
| `limit` | how many lambdas the server may run, the number of CPU cores by default, 0 for no limit. Every lambda server has a limit of its own, and the worker servers have theirs: a configuration with several of them can run up to the sum of their limits as processes. |
| `acquireTimeout` | how long a request waits for a lambda when all of them are busy and the limit is reached, 10000 ms by default, then it is answered with 503 |
| `startTimeout` | how long a lambda may take to load its module and start, 10000 ms by default (the init timeout of AWS), then it is stopped and the request is answered with 502 |
| `timeout` | how long the handler may take to answer, 900000 ms (15 minutes) by default, then the lambda is stopped and the request is answered with 504. `context.getRemainingTimeInMillis()` counts down to it. |
| `limitRequestBody` | the largest body of a request in bytes, 6291456 (6 MiB, the payload limit of AWS) by default, 0 for no limit. Larger ones are answered with 413. |
| `restrictFileSystem` | whether a lambda can only write to its own folders, true by default, see Storage below |
| `env` | variables for the lambdas. They do not get the environment of the server, only what node needs (`PATH`, `HOME`, `TZ`, `NODE_OPTIONS`, the proxies, ...) and what AWS sets for a function (`AWS_LAMBDA_FUNCTION_NAME`, `AWS_LAMBDA_FUNCTION_VERSION`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, `AWS_LAMBDA_LOG_GROUP_NAME`, `AWS_LAMBDA_LOG_STREAM_NAME`, `AWS_EXECUTION_ENV`, `LAMBDA_TASK_ROOT`, `_HANDLER`) |
| `communication` | how the request and the response reach the lambda, `ipc` (default) or `file` |

**Event and context.** The event is the one of the proxy integration (payload format 1.0): `resource`, `path`, `httpMethod`, `headers` (the names as the client wrote them, the last value of a repeated one), `multiValueHeaders`, `queryStringParameters`
(the last value of a repeated parameter, `null` when there are none), `multiValueQueryStringParameters`, `pathParameters` (`{ proxy }`), `stageVariables` (`null`), `requestContext`, and `body` with `isBase64Encoded`. The body is `null` for a request without one,
the text when it is valid UTF-8, otherwise base64. The context has `awsRequestId` (the `requestContext.requestId` of the event), `functionName`, `functionVersion`, `invokedFunctionArn`, `memoryLimitInMB`, `logGroupName`, `logStreamName`,
`getRemainingTimeInMillis()` and the old `done`, `succeed` and `fail`. A handler answers with the promise it returns (`async`) or with the callback, whichever comes first. A response has `statusCode`, `headers`, `multiValueHeaders`, `cookies`, `body` and `isBase64Encoded`.

**Waiting.** Requests that find all lambdas busy wait in line, the one that came first is served first, and are woken as soon as a lambda is free or one exits, nothing polls. A request whose client goes away while it waits leaves the line without taking a lambda
(`abandoned` in the metrics counts them, `waiting` is the length of the line).

**Failures** are answered the way API Gateway answers them, with a JSON object with a `message`: a handler that fails (an error to the callback, a rejection or a throw), a response without a valid `statusCode` or with a `body` that is not a string, a lambda that does not start
or exits during the request give 502 `{"message":"Internal server error"}`, the error goes to the log. A handler that takes longer than `timeout` gives 504 `{"message":"Endpoint request timed out"}`, a full line 503 `{"message":"Service Unavailable"}`
and a body that is too large 413 `{"message":"Request Entity Too Large"}`.

**Storage and lifespan.** Every lambda process has a folder of its own in the temporary folder of the system, and `TMPDIR`, `TMP` and `TEMP` point at its `tmp` folder, so `os.tmpdir()` is what `/tmp` is on AWS: it is kept for as long as the lambda runs (across
invocations), is not shared with another lambda, and is removed when the lambda exits. By default a lambda can write nowhere else (the code is read-only like on AWS), which is the permission model of node (`--permission`), so it needs a node that has it, and
child processes, workers and addons are allowed as they are on AWS. It does not restrict the network, and it is not a security boundary against native code. The path `/tmp` itself is not the folder, a handler that hardcodes it is refused. The 512 MB of AWS are not enforced.
The `file` communication keeps its files in a second folder of the lambda, which the server removes with it. A lambda is not handed out any more 14 minutes and 30 seconds after it started and is stopped (`SIGTERM`, `SIGKILL` after 5 seconds) when it is idle,
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

### Workers that crash

A worker that stops with an error, or at all within 5 seconds of starting, has crashed. The first crash is answered by starting another worker for the next request, as before.
After the second one in a row the server stops starting workers for that path for a while, 100 milliseconds at first and twice as long after every further crash up to 10 seconds, instead of starting a process for every request.
Requests that arrive in the meantime are answered with 503 and a `Retry-After`, unless a worker for the path is still running, which takes them. A worker that stays up for 5 seconds clears the count.
`failing` in the metrics lists the paths that are held back, with their crashes and the time left. Workers the server stops itself (an idle one that makes room, the shutdown) are no crash.

What a worker writes to its stdout and stderr is handed to `onStdout` and `onStderr` from the moment it starts.

### HTTPS

A server with `protocol: 'https'` is served on the https port for its host name (SNI), with the files in `key`, `cert` and, for the chain, `ca` (paths to PEM files).
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
which the `connections:*` metrics count. Both are in the top level of the configuration, next to the ports.

### Reloading the servers

The servers given as paths in `servers` are loaded again when their files change, while the server keeps running. The files that are watched are the file of a server, the local files it loads
(not the packages under `node_modules`) and its `key`, `cert` and `ca`. A file in `servers` that does not exist yet is watched too, and started once it is created.

- The writes that come within 100 milliseconds of each other are one change, as an editor can write a file several times when it saves it.
- Everything is loaded and checked before anything changes. A file that cannot be loaded (a syntax error, a server without a `hostname` or `protocol`, a certificate that cannot be read, a server that fails to start) is logged,
  and the servers keep running as they were.
- A server whose files did not change keeps running as it is, with its workers, lambdas and child process. Its certificates are read again, so a renewed certificate is used for the new connections.
- A server that was changed or removed takes no new requests. The requests it has already taken are answered by it, and its workers and child process are stopped once they are, or after 30 seconds,
  whichever comes first, which is what ends a websocket that stays open longer. Its idle lambdas are stopped at once, and the busy ones once they answered. A `proxy` server closes its connections
  to the target once the requests on them are answered, a websocket through it stays open until one of its ends closes it. A changed server is started anew next to it: a `child` server with a fixed
  `port` in its `proxyOptions` cannot start while the old one still has it.
- A `proxy` server with a `dynamic` target keeps the target that was registered with it when its file changes, as long as its `hostname` and `protocol` stay the same, so the service behind it does not
  have to register again (its `ttl` still counts from the last registration).
- The listening sockets stay open, so no connection is refused during a reload.

`watchServers: false` in the configuration turns watching off, `reloadOnSighup: true` loads the servers again on `SIGHUP` instead of stopping, for deployments that prefer to say when.
What a reload does not change, and needs a restart: the configuration itself (the list of `servers`, the servers defined in it rather than in a file of their own, the ports, `keepAliveTimeout`, `maxConnections`,
the stats and the logging), as it is given to the server once when it starts.

### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
