import type { ServerConfig } from '../types';

/** what the registered target of a server is known by: the host and the protocol, as it stays the one of the server while these do. Nothing for a server without a dynamic target. */
const getTargetKey = ({ type, protocol, hostname, proxyOptions }: ServerConfig) =>
  type === 'proxy' && proxyOptions?.dynamic ? `${protocol} ${hostname}` : undefined;

export default getTargetKey;
