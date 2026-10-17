import type { ConfigurationProblem, Configuration, ServerConfig } from '../types';

export interface ServerEntry {
  instance: ServerConfig;
  /** how the problems name the server */
  label: string;
}

/** servers of one host name and protocol, the later ones would never be asked, and a host that the stats endpoint answers before the servers do */
const findDuplicateProblems = (entries: ServerEntry[], { statsDomain }: Pick<Configuration, 'statsDomain'>): ConfigurationProblem[] => {
  const first = new Map<string, string>();
  const key = ({ protocol, hostname }: ServerConfig) => `${protocol}://${String(hostname).toLowerCase()}`;

  return entries.flatMap(({ instance, label }): ConfigurationProblem[] => {
    const earlier = first.get(key(instance));
    first.set(key(instance), earlier ?? label);
    const shadowed: ConfigurationProblem[] =
      statsDomain && instance.protocol === 'http' && String(instance.hostname).toLowerCase() === statsDomain.toLowerCase()
        ? [{ severity: 'warning', server: label, setting: 'hostname', message: 'is the statsDomain, which the stats endpoint answers before the servers' }]
        : [];

    return [...(earlier ? [{ severity: 'error' as const, server: label, setting: 'hostname', message: `is already served by ${earlier}` }] : []), ...shadowed];
  });
};

export default findDuplicateProblems;
