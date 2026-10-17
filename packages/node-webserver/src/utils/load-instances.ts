import createInstanceHandler from './create-instance-handler';
import loadInstanceModule from './load-instance-module';
import readFingerprint from './read-fingerprint';
import reportProblems from './report-problems';
import setupSecureContexts from './setupSecureContexts';
import validateServers from './validate-servers';
import type { LambdaStats } from '@koeroesi86/node-lambda-invoke';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
import type { CompressionBudget, Configuration, LoadedInstance, Logger } from '../types';

type Candidate = Omit<LoadedInstance, 'handler' | 'close'> | LoadedInstance;

const isLoaded = (candidate: Candidate): candidate is LoadedInstance => 'handler' in candidate;

/** the server of the entry as it is now: the one that runs when its files did not change, otherwise the definition loaded again, or nothing when its file is gone */
const findCandidate = (source: Configuration['servers'][number], previous: LoadedInstance[]): Candidate[] => {
  const running = previous.find((loaded) => loaded.source === source);

  if (typeof source !== 'string') {
    return [running ?? { source, instance: source, runtime: {}, files: [] }];
  }

  if (running && readFingerprint(running.files) === running.fingerprint) {
    return [running];
  }

  const loaded = loadInstanceModule(source);

  return loaded ? [{ source, ...loaded, runtime: {}, fingerprint: readFingerprint(loaded.files) }] : [];
};

interface Shared {
  workerBudget?: WorkerBudget;
  lambdaStats?: LambdaStats;
  compressionBudget?: CompressionBudget;
  /** the settings the servers are checked against, as a few of them depend on the others (the stats domain) */
  configuration?: Partial<Configuration>;
}

const start = (candidate: Candidate, previous: LoadedInstance[], logger: Logger, shared: Shared): LoadedInstance => ({
  ...candidate,
  ...createInstanceHandler(candidate.instance, candidate.runtime, {
    logger,
    ...shared,
    previous: previous.find(({ source }) => source === candidate.source),
  }),
});

/**
 * The servers of the configuration, keeping the ones of `previous` whose files did not change, with their workers, lambdas and child processes.
 * Everything is loaded and checked before anything is started (an error lists every problem of the servers), and what was started is stopped again when a server fails to start: on an error
 * this throws, and the servers of `previous` are left as they are.
 */
const loadInstances = (servers: Configuration['servers'], previous: LoadedInstance[], logger: Logger, shared: Shared = {}): LoadedInstance[] => {
  const candidates = servers.flatMap((source) => findCandidate(source, previous));
  // all the problems at once, before a certificate is read or anything is started
  reportProblems(validateServers(candidates, shared.configuration ?? {}), logger);
  // the certificates are read again for every server, the running ones too, as they are renewed without the definition changing
  setupSecureContexts(candidates);

  const started: LoadedInstance[] = [];
  try {
    return candidates.map((candidate) => (isLoaded(candidate) ? candidate : started[started.push(start(candidate, previous, logger, shared)) - 1]));
  } catch (error) {
    started.forEach(({ close }) => close(0));
    throw error;
  }
};

export default loadInstances;
