import { createHash } from 'crypto';
import type { ServerConfig } from '../types';

/**
 * What the application of a `child` server is known by, the same in fronts that would start the same one: the host, what is started with what, where it is reached, and the files
 * of the server. Arguments that a function makes are the ones it makes for port 0, as the port is not known yet.
 */
const getAppKey = ({ protocol, hostname, childOptions, proxyOptions, serverOptions }: ServerConfig, fingerprint?: string) => {
  const args = typeof childOptions?.args === 'function' ? childOptions.args([0]) : childOptions?.args;
  const definition = JSON.stringify([childOptions?.command, args, proxyOptions, serverOptions, fingerprint]);

  return `${protocol} ${hostname} ${createHash('sha256').update(definition).digest('hex')}`;
};

export default getAppKey;
