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
const limit = 100; // overall limit ox running lambdas

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

Coming soon, currently a basic `.env` way is available...
