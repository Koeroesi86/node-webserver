# Configuration

A `configuration.js` (or `configuration.json`) exports the top level options and the list of servers. The command line takes `--config <path>` (`nws-cli`). A working example per server type is in [`packages/node-webserver/examples/`](https://github.com/Koeroesi86/node-webserver/tree/master/packages/node-webserver/examples).

```javascript
module.exports = {
  portHttp: 80,
  portHttps: 443,
  http2: true,
  servers: [
    { hostname: 'web.localhost', protocol: 'http', type: 'worker', options: { root: '/path/to/files' } },
    './servers/api.js', // a server in a file of its own is watched and reloaded
  ],
};
```

## Top level

| Option | Meaning | Default |
|---|---|---|
| `portHttp`, `portHttps` | the ports of the two servers | |
| `http2` | serve HTTP/2 on the https port | off |
| `servers` | server definitions, or paths of files that export one | |
| `trustedProxies` | load balancers whose forwarding headers are believed (CIDRs, `loopback`, `linklocal`, `uniquelocal`, or `{ http, https }`) | nobody |
| `keepAliveTimeout` | how long an idle connection stays open, in ms | 65000 |
| `maxConnections` | open connections per server before new ones are dropped, 0 for no limit | 10000 |
| `shutdownTimeout` | how long a stop waits for requests in flight, in ms | 30000 |
| `workerLimit` | worker processes of all worker servers together, 0 for no limit | 0 |
| `watchServers` | reload servers when their files change | on |
| `reloadOnSighup` | reload on `SIGHUP` instead of stopping | off |
| `fileLogPath`, `logLevels` | where logs go and which levels are written | |

## A server

Every server has `hostname` (a wildcard like `*.example.com` is allowed), `protocol` and `type`. `https` servers also need `key` and `cert` (and `ca`) as paths to PEM files. The rest depends on the type:

| Type | Options |
|---|---|
| `worker` | `options`: `root`, `routes`, `fallthrough`, `warmPaths`, `static`, limits |
| `lambda` | `lambdaOptions`: `lambda`, `handler`, `routes`, `limit`, timeouts, `env` |
| `child` | `childOptions`, `proxyOptions`, `serverOptions` |
| `proxy` | `proxyOptions`: `target` or `dynamic`, `changeOrigin`, `forwardedHeaders` |
| any | `compression` |

The reference for each option is in the [README of the server](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md), and the types are in `packages/node-webserver/src/types/`.
