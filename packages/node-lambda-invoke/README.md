# Node Lambda invoke

A library that can be easily used for AWS lambda functions locally

## Dependencies

* [Node](https://nodejs.org/en/)
* [pnpm](https://pnpm.io/) (for development in this workspace)

## Usage

```bash
pnpm add @koeroesi86/node-lambda-invoke
```

Or with npm
```bash
npm i --save @koeroesi86/node-lambda-invoke
```

## Example

```javascript
const http = require('http');
const { httpMiddleware } = require('@koeroesi86/node-lambda-invoke');

const host = 'localhost';
const port = 8080;

const lambdaPath = './pathOfLambda.js';
const handlerKey = 'handler';
const logger = console.log;
const limit = 100; // limit of running lambdas of this middleware, defaults to the number of CPU cores, 0 for no limit

http
  .createServer(httpMiddleware({
    lambdaPath,
    handlerKey,
    logger,
    limit,
    communication: {
      // file|ipc|custom --- When 'custom' used, path is needed
      type: 'ipc',
    }
  }))
  .listen(
    { host, port, exclusive: true },
    () => console.log(`Server running on http://${host}:${port}`)
  );
```


## Running locally

```bash
pnpm start
```

## Configuration

The options of `httpMiddleware`:

| | |
| --- | --- |
| `lambdaPath` | the file of the handler |
| `handlerKey` | the export of the handler, `handler` by default |
| `logger` | gets the output of the lambdas and what happens to them |
| `limit` | how many lambdas the middleware may run, the number of CPU cores by default, 0 for no limit. Every middleware has a limit of its own. |
| `acquireTimeout` | how long a request waits for a lambda when all of them are busy and the limit is reached, 10000 ms by default, then it is answered with 503 |
| `startTimeout` | how long a lambda may take to load its module and start, 10000 ms by default, then it is stopped and the request is answered with 502 |
| `timeout` | how long the handler may take to answer, 900000 ms (15 minutes) by default, then the lambda is stopped and the request is answered with 504 |
| `limitRequestBody` | the largest body of a request in bytes, 6291456 (6 MiB, the payload limit of AWS) by default, 0 for no limit. Larger ones are answered with 413. |
| `restrictFileSystem` | whether a lambda can only write to its own folders (`os.tmpdir()`, the folder of the `file` communication) and not to the rest of the file system, true by default. Needs a node with the permission model. |
| `env` | variables for the lambdas, which get only a few of the process that runs the middleware (`PATH`, `HOME`, `TZ`, ...) and the ones AWS sets for a function (`AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT`, `_HANDLER`) |
| `communication` | `{ type: 'ipc' }` (default), `{ type: 'file' }`, or `{ type: 'custom', path }` for a storage of your own |

A lambda answers one request at a time. It is an AWS Lambda handler behind API Gateway (a REST API with the proxy integration), as far as that goes on one machine, and the README of [`@koeroesi86/node-webserver`](../node-webserver) describes the event, the context,
the answers, the storage and the differences in full. In short:

* the handler gets the event of the proxy integration, with `body` and `isBase64Encoded`, and a context with `awsRequestId` and `getRemainingTimeInMillis()`; it can be `async` or use the callback, be nested (`controllers.users.get`) and be in an ES module;
* requests that find all lambdas busy wait in line, first come first served, without polling, and leave it when their client goes away. `getLambdaStats()` reports `waiting` (the line) and `abandoned` (requests that left it);
* failures are answered the way API Gateway answers them, with a JSON `message`: 502 `Internal server error` for a failed handler, a malformed response or a lambda that does not start or exits, 504 `Endpoint request timed out`, 503 `Service Unavailable` and 413 `Request Entity Too Large`;
* a lambda has a `/tmp` of its own (`os.tmpdir()`) and cannot write anywhere else, it is drained after 14 minutes and 30 seconds and stopped when it is idle.
