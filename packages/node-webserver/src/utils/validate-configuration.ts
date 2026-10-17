import type { ConfigurationProblem, Configuration } from '../types';
import findSchemaProblems from './find-schema-problems';
import getSchemaValidator from './get-schema-validator';
import hydrateConfiguration from './hydrate-configuration';

/** the servers of the configuration are checked one by one by `validateServers`, here they are told apart from the paths only */
const withoutServers = (configuration: Partial<Configuration>) => ({
  ...configuration,
  servers: Array.isArray(configuration.servers)
    ? configuration.servers.map((server) => (typeof server === 'object' ? 'a server' : server))
    : configuration.servers,
});

/** What is wrong with the settings of the configuration besides its servers: the schema, and the ports that cannot be both. All of it, not the first. */
const validateConfiguration = (configuration: Partial<Configuration>): ConfigurationProblem[] => {
  const { portHttp, portHttps, portLookup } = hydrateConfiguration(configuration);
  const conflicts: ConfigurationProblem[] = [
    ...(portHttp !== 0 && portHttp === portHttps
      ? [{ severity: 'error' as const, setting: 'portHttps', message: `listens on the port of portHttp too: ${portHttp}` }]
      : []),
    ...(portLookup && portLookup.from > portLookup.to ? [{ severity: 'error' as const, setting: 'portLookup', message: 'starts above where it ends' }] : []),
  ];

  return [...findSchemaProblems(getSchemaValidator(), withoutServers(configuration)), ...conflicts];
};

export default validateConfiguration;
