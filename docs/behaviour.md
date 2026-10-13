# Behaviour

What the server does when things get busy, break or change. Defaults are the ones at the time of writing, the README of the server is the reference.

## Under load

| Situation | What happens |
|---|---|
| A worker file has no worker and the limit is used up | the request waits in line, first come first served, and is woken when there is room (no polling) |
| It waits longer than `limitRequestTimeout` (5 s), or `limitQueue` (1000) requests already wait | `503` with `Retry-After: 1` |
| The client goes away while it waits | it leaves the line at once and is counted as `abandoned` |
| A worker has had no request for `limitWorkerIdleTimeout` (5 min) | it is stopped; an idle worker is also stopped to make room for another file, but the last worker of a file only while it has no request |
| Lambdas are all busy | requests queue, then `503` after `acquireTimeout` (10 s) |
| A body is over `limitRequestBody` | `413` (no limit by default for workers, 6 MiB for lambdas) |
| An upload stalls | `504` after `limitResponseTimeout` counted from the last part that moved |
| More than `maxConnections` (10000) connections are open | new ones are dropped |

## On failure

- A worker that crashes is replaced for the next request. After two crashes in a row the path is held back for 100 ms, doubling up to 10 s, and requests get `503` with `Retry-After` unless another worker of it runs.
- A worker that loses the server exits. A worker that dies while writing a handed-off response leaves the client with a truncated body.
- A proxy target that is missing gives `503`, one that cannot be reached `502`, one that stays silent `504` (`proxyTimeout`, 60 s).
- A lambda that fails gives `502`, one that is too slow `504`, as API Gateway does.

## On a reload

Servers given as paths in `servers` are watched with their local files and certificates. A change is applied once everything loads; a file that does not load is logged and the servers keep running as they were.
Unchanged servers keep their workers and processes, changed ones finish their requests (up to 30 s) while a new one starts next to them, and the listening sockets stay open. The configuration itself needs a restart.
`watchServers: false` turns watching off, `reloadOnSighup: true` reloads on `SIGHUP`.

## On a stop

`SIGINT`, `SIGTERM` and `SIGHUP` stop the server gracefully: it stops listening, closes websockets with code 1001, answers the requests in flight until `shutdownTimeout` (30 s), stops the workers, lambdas and children, writes the logs and exits.
A second signal, an uncaught exception, `SIGUSR1` and `SIGUSR2` end the process at once.

## Observing it

- `event.getMetrics()` in a worker gives uptime, memory, event loop delay, request counts and latency histograms, and the state of every worker, lambda and connection pool.
- Access logs and other logs are batched per turn of the event loop and per 100 ms for files, because every write is a system call on the thread that serves requests.
