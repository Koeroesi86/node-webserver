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
