import path from 'path';
import type { ConfigurationProblem, Configuration } from '../types';
import { loadInstanceModule } from '../children';
import { getFrontCount } from '../cluster';
import validateConfiguration from './validate-configuration';
import validateServers from './validate-servers';

type Entry = Parameters<typeof validateServers>[0][number];

const loadEntry = (source: string): { entry?: Entry; problems: ConfigurationProblem[] } => {
  try {
    const loaded = loadInstanceModule(source);

    return loaded
      ? { entry: { source, instance: loaded.instance }, problems: [] }
      : { problems: [{ severity: 'warning', server: source, setting: '(file)', message: `does not exist: ${path.resolve(source)}, the server is left out` }] };
  } catch (error) {
    return {
      problems: [
        { severity: 'error', server: source, setting: '(file)', message: `could not be loaded: ${error instanceof Error ? error.message : String(error)}` },
      ],
    };
  }
};

/**
 * Everything wrong with a configuration and the server files it names, and how many fronts `startCluster` would run for it.
 * The server files are loaded, which runs them. A file that cannot be loaded is a problem of its own and the others are still checked.
 */
const inspectConfiguration = (configuration: Partial<Configuration>): { problems: ConfigurationProblem[]; frontCount: number } => {
  const { servers = [] } = configuration;
  const loaded = Array.isArray(servers)
    ? servers.map((source) => (typeof source === 'string' ? loadEntry(source) : { entry: { source, instance: source }, problems: [] }))
    : [];
  const entries = loaded.flatMap(({ entry }) => (entry ? [entry] : []));
  const frontCount = getFrontCount(
    configuration,
    entries.map(({ instance }) => instance)
  );

  return {
    problems: [...validateConfiguration(configuration), ...loaded.flatMap(({ problems }) => problems), ...validateServers(entries, configuration)],
    frontCount,
  };
};

export default inspectConfiguration;
