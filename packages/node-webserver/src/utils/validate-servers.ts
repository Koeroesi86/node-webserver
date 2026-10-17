import type { ConfigurationProblem, Configuration, LoadedInstance } from '../types';
import findDuplicateProblems from './find-duplicate-problems';
import findSchemaProblems from './find-schema-problems';
import findServerProblems from './find-server-problems';
import getSchemaValidator from './get-schema-validator';
import getServerLabel from './get-server-label';
import hydrateConfiguration from './hydrate-configuration';

type Entry = Pick<LoadedInstance, 'source' | 'instance'>;

const label = ({ source, instance }: Entry) =>
  typeof instance?.hostname === 'string' ? getServerLabel(instance, source) : String(typeof source === 'string' ? source : 'a server');

/** What is wrong with the servers: each one against the schema and the rest of what the settings promise, and the servers together. All of it, not the first. */
const validateServers = (entries: Entry[], configuration: Partial<Configuration>): ConfigurationProblem[] => {
  const validate = getSchemaValidator('/definitions/server');
  const labelled = entries.map((entry) => ({ ...entry, label: label(entry) }));
  const own = labelled.flatMap(({ instance, label: server }) => [...findSchemaProblems(validate, instance, server), ...findServerProblems(instance, server)]);
  const together = findDuplicateProblems(labelled, hydrateConfiguration(configuration));

  return [...own, ...together];
};

export default validateServers;
