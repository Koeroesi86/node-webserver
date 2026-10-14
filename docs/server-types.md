# Server types

Each entry of `servers` has a `hostname`, a `protocol` (`http` or `https`) and a `type`.

| Type | Runs behind the front server | Pick it for |
|---|---|---|
| `worker` | a pool of Node processes per worker file, each called with `(event, callback)` | request handlers written for this server, static files, websockets, streaming |
| `lambda` | an AWS Lambda handler, one per process, one request at a time | code that also runs on AWS, or that you want to test as it runs there |
| `child` | any program started as a child process, on a free port (`%PORT%` in `childOptions.args`) or the fixed `proxyOptions.port` | an existing app that listens on a port |
| `proxy` | an application that runs on its own, at a fixed `target` or one it registers | a service somewhere else, or one that changes its address |

## worker

- The worker file is found under `options.root`, or named by `options.routes` (a `path` or a `pattern`, first match wins).
- Pools grow per file up to a limit, idle workers stop after 5 minutes by default, and `warmPaths` starts some in advance.
- The body of a request is read from `event.bodyStream`. Responses can be streamed, and websockets are supported.
- The static worker serves files with range requests, `Cache-Control` per folder or extension, and precompressed `.br` and `.gz` files.

More: [the server README](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md#routes), [node-worker-express](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/README.md).

## lambda

- `lambdaOptions.lambda` is the file and `handler` the export (nested names work). `routes` hosts several lambdas on one server.
- The event is the proxy integration payload format 1.0. Failures are answered as API Gateway does: 502 for a handler that fails, 504 for a timeout, 503 for a full line, 413 for a body over 6 MiB.
- Lambdas get a clean environment and a temporary folder of their own, and by default can write nowhere else.

More: [Lambdas](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md#lambdas), [node-lambda-invoke](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-lambda-invoke/README.md).

## child

The server starts `childOptions.command` with its `args`, and proxies requests to its port on `localhost` (`proxyOptions`, `serverOptions.protocol` and `childOptions` are required). The port is a free one, replaced for `%PORT%` in the arguments (or the result of an `args` function), unless `proxyOptions.port` is fixed. The child is stopped with the server. Requests and websockets are passed on as for a `proxy` server with a fixed target: 502 when the child cannot be reached, 504 when it stays silent.

## proxy

- A fixed `target`, or a `dynamic` one that the application sets with a `PUT` to a control path, authenticated by a per host token.
- Targets must be public IP addresses unless `allowPrivate` is set, and the control path accepts HTTPS only.
- Answers 503 while there is no target, 502 when it cannot be reached, 504 when it stays silent.
- Forwarding headers are trusted only from `trustedProxies`.

More: [Proxy servers](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md#proxy-servers).
