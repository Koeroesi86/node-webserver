# Node Worker Express [![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)

Express JS library for [@koeroesi86/node-worker](https://www.npmjs.com/package/@koeroesi86/node-worker)

Usage:
```javascript
const { middleware } = require('@koeroesi86/node-worker-express');
const express = require('express');
const path = require('path');

const app = express();
app.use(middleware({ root: path.resolve('./public') }));
app.listen(80);
```

### To run the example included:
```bash
pnpm install
pnpm --filter @koeroesi86/node-worker-express build
pnpm --filter @koeroesi86/node-worker-express start
```

For all options see [types](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/src/types/index.ts).
