import { existsSync } from 'fs';
import { resolve } from 'path';
import { PACKAGE_ROOT } from './constants';
import type { Configuration, ServerInstance } from './types';
import exampleConfiguration from './configuration.example';

const certificateFolder = resolve(PACKAGE_ROOT, '.certificates/localhost');
const key = resolve(certificateFolder, 'privkey.pem');
const cert = resolve(certificateFolder, 'cert.pem');
const lambdaServer: ServerInstance = {
  hostname: 'lambda.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: {
    lambda: resolve(PACKAGE_ROOT, 'examples/exampleLambda.js'),
    handler: 'handler',
  },
};
const failuresLambda = resolve(PACKAGE_ROOT, 'examples/lambda-failures/exampleLambda.js');
// a lambda that crashes loses only the request it runs, the others are answered by the lambdas that are left or started in its place
const lambdaCrashServer: ServerInstance = {
  hostname: 'lambda-crash.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: { lambda: failuresLambda, handler: 'handler', limit: 4 },
};
// two lambdas that answer after 1.5 seconds, and a request waits half a second for one: the rest is answered with 503
const lambdaOverloadServer: ServerInstance = {
  hostname: 'lambda-overload.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: { lambda: failuresLambda, handler: 'handler', limit: 2, acquireTimeout: 500 },
};
const lambdaFileServer: ServerInstance = {
  hostname: 'lambda-file.localhost',
  protocol: 'http',
  type: 'lambda',
  lambdaOptions: { lambda: failuresLambda, handler: 'handler', communication: 'file', limit: 2 },
};
const compressedServer: ServerInstance = {
  hostname: 'compressed.localhost',
  protocol: 'http',
  type: 'worker',
  compression: true,
  options: {
    root: resolve(PACKAGE_ROOT, 'examples'),
    index: ['exampleWorker.js'],
  },
};
const uploadServer: ServerInstance = {
  hostname: 'upload.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: resolve(PACKAGE_ROOT, 'examples/upload'),
    index: ['exampleWorker.js'],
  },
};
const healthServer: ServerInstance = {
  hostname: 'health.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: resolve(PACKAGE_ROOT, 'examples/health'),
    index: ['exampleWorker.js'],
  },
};
const upstreamPort = Number(process.env.PORT_UPSTREAM ?? 8081);
// an application on a port of its own, started by the server as a child: the target of the proxy server below
const upstreamServer: ServerInstance = {
  hostname: 'upstream.localhost',
  protocol: 'http',
  type: 'child',
  childOptions: {
    command: process.execPath,
    args: [resolve(PACKAGE_ROOT, 'examples/staticServer.js'), '--path', resolve(PACKAGE_ROOT, 'examples/static'), '--port', `${upstreamPort}`],
  },
  proxyOptions: { port: upstreamPort },
  serverOptions: { protocol: 'http', proxyTarget: `http://127.0.0.1:${upstreamPort}` },
};
const proxiedServer: ServerInstance = {
  hostname: 'proxied.localhost',
  protocol: 'http',
  type: 'proxy',
  proxyOptions: { target: `http://127.0.0.1:${upstreamPort}` },
};
/** how many routes of each kind come before the one that the load test asks for, so that a request goes through all of them */
const routesBefore = 200;
const routesServer: ServerInstance = {
  hostname: 'routes.localhost',
  protocol: 'http',
  type: 'worker',
  options: {
    root: resolve(PACKAGE_ROOT, 'examples/routes'),
    routes: [
      ...Array.from({ length: routesBefore }, (_, index) => ({ path: `/page/${index}`, worker: 'exampleWorker.js' })),
      ...Array.from({ length: routesBefore }, (_, index) => ({ pattern: `/section-${index}/(?<id>[0-9]+)`, worker: 'exampleWorker.js' })),
      { pattern: '/items/(?<id>[0-9]+)', worker: 'exampleWorker.js' },
    ],
    fallthrough: false,
  },
};
const secureServers: ServerInstance[] =
  existsSync(key) && existsSync(cert)
    ? [
        {
          hostname: 'secure.localhost',
          protocol: 'https',
          key,
          cert,
          type: 'worker',
          options: {
            root: resolve(PACKAGE_ROOT, 'examples'),
            index: ['exampleWorker.js'],
          },
        },
      ]
    : [];

const withWorkerLimit = (server: ServerInstance): ServerInstance =>
  server.options && process.env.WORKERS_PER_PATH ? { ...server, options: { ...server.options, limitPerPath: Number(process.env.WORKERS_PER_PATH) } } : server;

/**
 * Example configuration without per-request access logs by default and on unprivileged ports,
 * so load tests measure the server instead of log file I/O.
 * The logger reads its levels from NODE_WEBSERVER_CONFIG, so this module has to be selected through it, load-test-env does that.
 *
 * `lambda-crash.localhost`, `lambda-overload.localhost` and `lambda-file.localhost` serve `examples/lambda-failures/exampleLambda.js` for the lambda scenario (`lambda.ts`):
 * a lambda that crashes, more requests than lambdas, and the `file` communication.
 * `compressed.localhost` serves the example worker with compression on.
 * `upload.localhost` serves a worker that reads the request body as a stream.
 * `proxied.localhost` is a proxy server in front of a static file server on PORT_UPSTREAM (8081), which the server starts as a child.
 * `health.localhost` serves a worker with /health and /metrics, from the metrics the server gives to workers.
 * `routes.localhost` finds its worker in a table of routes, where `/items/<id>` is the last of 401, and answers anything else with 404 itself.
 * `secure.localhost` is only served when a certificate exists in `.certificates/localhost`, see tools/README.md#load-tests.
 * WORKERS_PER_PATH overrides the number of workers started per path.
 * ACCESS_LOGS=1 turns the access logs on (the info and success levels), so that the logger is measured on the path of every request.
 */
const configuration = {
  ...exampleConfiguration,
  logLevels: {
    system: true,
    info: process.env.ACCESS_LOGS === '1',
    success: process.env.ACCESS_LOGS === '1',
    error: true,
    warning: true,
  },
  servers: [
    ...exampleConfiguration.servers,
    lambdaServer,
    lambdaCrashServer,
    lambdaOverloadServer,
    lambdaFileServer,
    compressedServer,
    uploadServer,
    healthServer,
    routesServer,
    upstreamServer,
    proxiedServer,
    ...secureServers,
  ].map(withWorkerLimit),
  portHttp: Number(process.env.PORT_HTTP ?? 8080),
  portHttps: Number(process.env.PORT_HTTPS ?? 8443),
} satisfies Configuration;

export = configuration;
