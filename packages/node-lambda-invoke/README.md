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
const limit = 100; // overall limit of running lambdas, defaults to the number of CPU cores, 0 for no limit

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
| `env` | variables for the lambdas, which get only a few of the process that runs the middleware (`PATH`, `HOME`, `TZ`, ...) and the ones AWS sets for a function (`AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT`, `_HANDLER`) |
| `communication` | `{ type: 'ipc' }` (default), `{ type: 'file' }`, or `{ type: 'custom', path }` for a storage of your own |

A lambda answers one request at a time. Requests that find all lambdas busy wait in line: the first one that came is served first, and it is woken as soon as a lambda is free or one exits, nothing polls. A request whose client goes away while it waits leaves
the line without taking a lambda. `getLambdaStats()` reports `waiting` (the line) and `abandoned` (requests that left it).

Failures are answered the way API Gateway answers them, with a JSON object with a `message`. A handler that fails (an error to the callback, or a throw), a response without a valid `statusCode` or with a `body` that is not a string, a lambda that does not start
or exits during the request give 502 `{"message":"Internal server error"}`; the error is written to the stderr of the lambda, which goes to the `logger`. A handler that takes longer than `timeout` gives 504 `{"message":"Endpoint request timed out"}`,
and a request that waited longer than `acquireTimeout` 503 `{"message":"Service Unavailable"}`.
