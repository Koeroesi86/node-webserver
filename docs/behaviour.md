# Behaviour

What the server does when things get busy, break or change. Defaults are the ones at the time of writing, the README of the server is the reference.

## Under load

| Situation | What happens |
|---|---|
| A worker file has no worker and the limit is used up | the request waits in line, first come first served, and is woken when there is room (no polling) |
| It waits longer than `limitRequestTimeout` (5 s), or `limitQueue` (1000) requests already wait | `503` with `Retry-After: 1` |
| The client goes away while it waits | it leaves the line at once and is counted as `abandoned` |
| A worker has had no request for `limitWorkerIdleTimeout` (5 min) | it is stopped; an idle worker is also stopped to make room for another file, but the last worker of a file only while it has no request |
| A file is kept warm (`warmPaths`) and a worker of it stops, crashes or is stopped to make room | it is started again, but only into room that no waiting request needs, and after a crash only when the backoff is over; when a worker ends, waiting requests (also of other pools sharing the limit) are served first and the warm files take what is left |
| Lambdas are all busy | requests queue, then `503` after `acquireTimeout` (10 s) |
| A body is over `limitRequestBody` | `413` (no limit by default for workers, 6 MiB for lambdas) |
| An upload stalls | `504` after `limitResponseTimeout` counted from the last part that moved |
| More than `maxConnections` (10000) connections are open | new ones are dropped |

## On failure

- A worker that crashes is replaced for the next request. After two crashes in a row the path is held back for 100 ms, doubling up to 10 s, and requests get `503` with `Retry-After` unless another worker of it runs.
- A worker that loses the server exits. A worker that dies while writing a handed-off response leaves the client with a truncated body.
- A proxy target that is missing gives `503`, one that cannot be reached `502`, one that stays silent `504` (`proxyTimeout`, 60 s).
- A lambda that fails gives `502`, one that is too slow `504`, as API Gateway does.

## With several front processes

| Situation | What happens |
|---|---|
| A front ends | it is replaced, at once the first time, then after 100 ms doubling up to 10 s; the others keep serving |
| A replacement finds another configuration or server version | it ends, and the primary applies the change; with no front left and none to start the server ends with an error |
| The primary dies | the fronts and their workers exit |
| A front is at its share of `maxConnections` | its new connections are dropped, even while another front has room |
| A reload would change the number of fronts | new fronts replace the old ones |

All fronts reload together: the primary watches the files, every front prepares, and they serve the new servers only when all of them loaded the same, otherwise all keep what they run. Metrics and stats are those of the front that answers. `child` servers, `acme` and dynamic proxy targets need one front.

## On a reload

Servers given as paths in `servers` are watched with their local files, and certificates. For every server, also one written in the configuration, the `root`, the route files and the index files under the `root` of its workers and the files of its lambdas are watched. A change of only a module that a worker imports is not noticed, unless a deploy switches a link. Links are followed: a deploy that points a symlinked folder to a new release reloads the servers under it (keep at least two releases, as a draining worker can still load files from the old one). A change is applied once everything loads; a file that does not load is logged and the servers keep running as they were.
Unchanged servers keep their workers and processes, changed ones finish their requests (up to 30 s) while a new one starts next to them, and the listening sockets stay open. A change of the configuration itself is applied as below.
`watchServers: false` turns watching off, `reloadOnSighup: true` reloads on `SIGHUP`.

## On a change of the configuration

With the command line (or `startCluster` with `configurationFile`) the configuration file and the files it loads are watched. The new configuration is checked first, a wrong one keeps the running server. New fronts start next to the old ones, which stop once their requests are answered; limits can be exceeded meanwhile.
The server restarts instead, refusing new connections meanwhile, when `frontProcesses` changes between one front and several, when it has a `child` server, `acme` or a dynamic proxy target, or when its version changed. A start that fails after a restart is tried again. Changes of environment variables are not seen.

## On a stop

`SIGINT`, `SIGTERM` and `SIGHUP` stop the server gracefully: it stops listening, closes websockets with code 1001, answers the requests in flight until `shutdownTimeout` (30 s), stops the workers, lambdas and children, writes the logs and exits.
A second signal, an uncaught exception, `SIGUSR1` and `SIGUSR2` end the process at once.

## Observing it

- `event.getMetrics()` in a worker gives uptime, memory, event loop delay, request counts and latency histograms, and the state of every worker, lambda and connection pool.
- Access logs and other logs are batched per turn of the event loop and per 100 ms for files, because every write is a system call on the thread that serves requests.
