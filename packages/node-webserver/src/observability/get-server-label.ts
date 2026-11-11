import type { ServerConfig } from '../types';

/** how a problem names its server: the host name with its protocol, and the file it comes from when it is not defined in the configuration itself */
const getServerLabel = (instance: Pick<ServerConfig, 'hostname' | 'protocol'>, source?: string | object) =>
  `${instance.protocol}://${instance.hostname}${typeof source === 'string' ? ` (${source})` : ''}`;

export default getServerLabel;
