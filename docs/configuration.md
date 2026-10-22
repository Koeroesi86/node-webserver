# Configuration

A `configuration.js` (or `configuration.json`) exports the top level options and the list of servers. The command line takes `--config <path>` (`nws-cli`), and `--check` checks the configuration without starting the server (see [Checking the configuration](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md#checking-the-configuration)). A working example per server type is in [`packages/node-webserver/examples/`](https://github.com/Koeroesi86/node-webserver/tree/master/packages/node-webserver/examples).

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
| `unknownHostPage` | a file that answers a request for a host no server takes (`421`), instead of a plain text | plain text |
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
| any | `compression`, `rules` (redirects and rewrites that run before the server of the host), `errorPages` (files that answer the 404, 502, ... of the host), `defaultHost` (answer the requests of its protocol that no server takes) |
| `https` | `redirectHttp` (redirect the http requests for the host to https), `hsts` (`Strict-Transport-Security`), `acme` (get and renew the certificate from Let's Encrypt, instead of `key` and `cert`) |

The reference for each option is in the [README of the server](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md), and the types are in `packages/node-webserver/src/types/`.

## Checking

The configuration is checked against [`configuration.schema.json`](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/configuration.schema.json) and a few rules a schema cannot hold (files, certificates, patterns, duplicate hosts), when the server starts and on every reload.
`nws-cli --config <path> --check` does it alone and exits with 1 on an error, with every problem listed with its server and setting. A reload with a problem keeps the running servers and logs the same report.
