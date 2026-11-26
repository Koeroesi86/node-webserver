import type { ConfigurationProblem, Configuration, LoadedInstance } from '../types';
import { findDuplicateProblems, findFrontProblems, findSchemaProblems, findServerProblems, getSchemaValidator } from '../problems';
import { getServerLabel } from '../observability';
import hydrateConfiguration from './hydrate-configuration';

type Entry = Pick<LoadedInstance, 'source' | 'instance'>;

const label = ({ source, instance }: Entry) =>
  typeof instance?.hostname === 'string' ? getServerLabel(instance, source) : String(typeof source === 'string' ? source : 'a server');

/**
 * What is wrong with the servers: each one against the schema and the rest of what the settings promise, and the servers together. All of it, not the first.
 * `frontCount` is how many fronts would run them, as a few servers work with one only.
 */
const validateServers = (entries: Entry[], configuration: Partial<Configuration>, frontCount = 1): ConfigurationProblem[] => {
  const validate = getSchemaValidator('/definitions/server');
  const labelled = entries.map((entry) => ({ ...entry, label: label(entry) }));
  const own = labelled.flatMap(({ instance, label: server }) => [...findSchemaProblems(validate, instance, server), ...findServerProblems(instance, server)]);
  const together = findDuplicateProblems(labelled, hydrateConfiguration(configuration));

  const fronts = frontCount > 1 ? labelled.flatMap(({ instance, label: server }) => findFrontProblems(instance, server)) : [];

  return [...own, ...together, ...fronts];
};

export default validateServers;
