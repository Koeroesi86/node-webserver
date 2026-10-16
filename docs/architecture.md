# Architecture

## Processes

```
client ──► front server (one Node process) ──┬─► worker pool       one pool per worker file
                                             ├─► lambda processes  one process per lambda, one request at a time
                                             ├─► child process     any application, proxied to
                                             └─► proxy target      an application that runs on its own
```

The front server listens on the http and the https port (HTTP/2 and SNI optional), finds the server definition for the `Host` of a request, and hands the request to what runs behind it. It is a single process on purpose.

## The request path

1. A connection is accepted. TLS ends here, with a certificate per host name.
2. The virtual host is looked up by the host name (exact names first, then wildcards in the order of the configuration).
3. The middleware of the server type takes over: the worker pool of `node-worker-express`, the `lambda` middleware, or the `proxy` middleware (`packages/node-webserver/src/middlewares/`).
4. Access logs are written when the response is complete, and compression is applied if the server has it on.

`startServer.ts` builds two express apps from the configuration, one for http and one for https with SNI. With `http2` on, the https port also serves a separate app for HTTP/2 requests.

## Rules for the front process

- Nothing is done there per request that can be done behind it.
- Changes on that path are measured with the load test.
- Request bodies are streamed to workers in parts with a flow control, so memory stays flat for uploads of any size.
- Big bodies (responses of 8 MiB and over by default, requests over a configured size) skip the server: it hands the client socket to the worker.

## Channels

Server and workers talk over a socket pair, the fourth stdio of the worker, not the IPC of Node. A message is a frame with JSON metadata and raw body bytes, and messages written in the same turn of the event loop leave in one write.
Messages are acknowledged, so a slow side slows the other down instead of filling memory. A worker that loses the server exits. Workers can ask the server for its metrics over the same channel.
Details: [How the server and the workers talk](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/README.md#how-the-server-and-the-workers-talk).

## Packages

```
node-webserver-cli ────────┐
                           ├─► node-webserver ─┬─► node-lambda-invoke
node-webserver-service ────┘                   └─► node-worker-express ─► node-worker
```

| Package | Role |
|---|---|
| `node-webserver` | the front server and its configuration |
| `node-webserver-cli`, `node-webserver-service` | thin wrappers: command line runner and systemd or launchd service generator |
| `node-lambda-invoke` | runs Lambda style handlers locally, each in its own process |
| `node-worker-express` | the express middleware and the worker pools on top of `node-worker` |
| `node-worker` | WebWorker-like API for Node |

`tools/` (`@koeroesi86/tools`) is never published: versioning for the pipeline and the k6 load tests.
