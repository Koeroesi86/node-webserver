import type { Configuration } from './types';
import exampleConfiguration from './configuration.example';

/**
 * Example configuration without per-request access logs and on unprivileged ports,
 * so load tests measure the server instead of log file I/O.
 * The logger reads its levels from NODE_WEBSERVER_CONFIG, so this module has to be selected through it.
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
  servers: exampleConfiguration.servers.map((server) => ({
    ...server,
    options: { ...server.options, ...(process.env.WORKERS_PER_PATH && { limitPerPath: Number(process.env.WORKERS_PER_PATH) }) },
  })),
  portHttp: Number(process.env.PORT_HTTP ?? 8080),
  portHttps: Number(process.env.PORT_HTTPS ?? 8443),
} satisfies Configuration;

export = configuration;
