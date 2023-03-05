# Node Worker

[![Publish](https://github.com/Koeroesi86/node-worker/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-worker/actions/workflows/publish.yml)

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
yarn example
```

