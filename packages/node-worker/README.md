# Node Worker

[![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)

NodeJS implementation of WebWorkers

```typescript
interface Worker {
    terminate: void;
    postMessage: void;
    onmessage: Function;
    onerror: Function;
    addEventListener: void;
    removeEventListener: void;
    dispatchEvent: void;
}
```

## Usage

```javascript
const Worker = require('@koeroesi86/node-worker');

const instance = new Worker('ls');
instance.terminate();
```

Or checkout the pproject and run
```javascript
pnpm --filter @koeroesi86/node-worker example
```


## Waiting line

The queue the worker pools are built on is exported next to the class: it hands a resource to the requests in line, the first one first, and rejects a request that waits too long or whose client went away.

```javascript
const { WaitingLine } = require('@koeroesi86/node-worker');
```

## The pool of worker processes

A pool of worker processes on the class above, exported as `@koeroesi86/node-worker/pool`: leases that count as the load of a worker, a framed channel to each process, restart backoff for a path that keeps crashing,
idle eviction, warm workers, a budget shared by several pools and metrics. [@koeroesi86/node-worker-express](https://www.npmjs.com/package/@koeroesi86/node-worker-express) serves worker files with it, and
[@koeroesi86/node-lambda-invoke](https://www.npmjs.com/package/@koeroesi86/node-lambda-invoke) runs lambdas on it, so a feature of the pool is there for both.

```javascript
const { WorkerPool, WORKER_EVENT } = require('@koeroesi86/node-worker/pool');

const pool = new WorkerPool({ acquireTimeout: 5000 });
const lease = await pool.acquire('/srv/workers/api.js', { cwd: '/srv' }, 4); // at most 4 processes for the file
lease.subscribe('request-1', (message) => console.log(message), (code) => console.log('the worker exited', code));
lease.send({ type: WORKER_EVENT.REQUEST, requestId: 'request-1', event: { /* the request */ } });
// ...once the request is over:
lease.release();
```

`acquire(workerPath, options, limit, signal)` hands out an idle worker for the file, else starts one below `limit` (0 or less keeps one), else the least busy one, and waits in line when the pool is at its `overallLimit`.
It rejects with `WorkerBusyError` (the line is full, or the request waited for `acquireTimeout`), `WorkerUnavailableError` (the file keeps crashing, retry after `retryAfterMs`) or `WorkerAbandonedError` (the signal was aborted).
`options` are the options of `spawn` (`env`, `cwd`, `execArgv`, ...), or a function that makes them when a process is started.

### Options of the pool

| | |
| --- | --- |
| `overallLimit` | how many worker processes the pool runs, 0 for no limit |
| `acquireTimeout` | how long a request waits for a worker, 10000 ms by default |
| `maxQueue` | how many requests may wait, the next ones are refused at once, 0 for no limit |
| `idleTimeout` | a worker with no request for this long is stopped, 0 keeps idle workers |
| `budget` | a limit shared with other pools, made by `createWorkerBudget` |
| `restartBackoff` | when a worker that crashed is started again |
| `onExit`, `onStdout`, `onStderr` | what happens to the workers: their exit code, what they write |
| `createCommand` | the executable and arguments that run a worker file, `node --expose-gc worker-invoke.js <file>` by default. The arguments are not split on spaces, so a path with spaces works. |
| `concurrency` | how many requests one worker takes at the same time, 0 for no limit. With 1 a worker answers one request at a time and the next ones wait in line, in order, until a worker is released or one can be started: it is a runtime like a lambda, not a server. |
| `startTimeout` | how long a worker may take to say `READY`, 0 (default) does not wait for it. A worker that is not ready in time is killed, which counts as a crash of its path (so the backoff applies), and `lease.ready()` rejects with a `WorkerStartError`. |
| `maxAge` | a worker older than this gets no more requests and is stopped as soon as it has none, never in the middle of a request. 0 for no limit. |
| `stopSignal`, `killAfter` | the signal that stops a worker (`SIGINT` by default), and how long it gets to stop before it is killed with `SIGKILL`, 0 (default) waits for ever |
| `prepareWorker` | called for every worker before it starts: returns the spawn `options` that replace the ones of the request (`env` as a whole, so an allowlist stays one; `execArgv` for the flags of node), and `onClose`, called once the worker ended or could not be started, to remove what was made for it (folders) |

The lease has `send`, `subscribe`, `handOff` and `release`, and for a pool that waits for the handshake `ready()`, which resolves when the worker is ready for its request. `kill()` kills a worker whose request ran out of time without counting a crash,
the lease is still to be released. `getStats()` has `workers`, `starting` (workers that are not ready yet), `active` (requests that run), `waiting`, `refused`, `abandoned`, `evicted`, `failing` and `paths`.

### The side of the worker process

`worker-invoke.js` is the runner of the worker files of node-worker-express: it loads the file and calls `startWorkerProcess(worker)`, which opens the channel (the fourth stdio of the process), serves the requests that come over it with
`worker(event, callback)`, and sends `READY`. A runner of your own, which loads its file differently (an ES module, for example) or adapts the request, calls `startWorkerProcess` once it is ready and is given to the pool with `createCommand`:
this is how the lambdas of node-lambda-invoke run. The event the worker gets has the `requestId`, and for a server that sets them the `rawHeaders` (names and values as the client wrote them), the `httpVersion` and the `deadline`;
a response header can be an array for a header with several values.

How the messages travel, and what a worker can do, is in [How the server and the workers talk](../node-worker-express/README.md#how-the-server-and-the-workers-talk).
