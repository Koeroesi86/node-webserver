import { existsSync } from 'fs';
import { resolve } from 'path';
import { PACKAGE_ROOT } from './constants';
import type { Configuration, ServerInstance } from './types';
import exampleConfiguration from './configuration.example';

const certificateFolder = resolve(PACKAGE_ROOT, '.certificates/localhost');
const key = resolve(certificateFolder, 'privkey.pem');
const cert = resolve(certificateFolder, 'cert.pem');
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
 * Example configuration without per-request access logs and on unprivileged ports,
 * so load tests measure the server instead of log file I/O.
 * The logger reads its levels from NODE_WEBSERVER_CONFIG, so this module has to be selected through it, load-test-env does that.
 *
 * `secure.localhost` is only served when a certificate exists in `.certificates/localhost`, see load-tests/README.md.
 * WORKERS_PER_PATH overrides the number of workers started per path.
 */
const configuration = {
  ...exampleConfiguration,
  logLevels: {
    system: true,
    info: false,
    success: false,
    error: true,
    warning: true,
  },
  servers: [...exampleConfiguration.servers, ...secureServers].map(withWorkerLimit),
  portHttp: Number(process.env.PORT_HTTP ?? 8080),
  portHttps: Number(process.env.PORT_HTTPS ?? 8443),
} satisfies Configuration;

export = configuration;
