import path from 'path';
import createInstanceHandler from './create-instance-handler';
import { applyAcmeFiles } from '../acme';
import { getEntryFiles, readFingerprint } from '../reload';
import { loadInstanceModule } from '../children';
import { FrontCountError, getFrontCount, splitServerLimits } from '../cluster';
import { reportProblems } from '../problems';
import { setupSecureContexts } from '../tls';
import { validateServers } from '../configuration';
import type { LambdaStats } from '@koeroesi86/node-lambda-invoke';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
import type { CompressionBudget, Configuration, FrontShare, LoadedInstance, Logger, ServerConfig, SharedTargets } from '../types';

type Candidate = Omit<LoadedInstance, 'handler' | 'close'> | LoadedInstance;

const isLoaded = (candidate: Candidate): candidate is LoadedInstance => 'handler' in candidate;

/**
 * the files of the workers and lambdas of a server, which run in other processes and are not in the require graph. None for settings of the wrong type,
 * which the check of the servers reports.
 */
const findEntryFiles = (instance: ServerConfig) => {
  try {
    return getEntryFiles(instance);
  } catch {
    return [];
  }
};

const withFingerprint = (candidate: Omit<Candidate, 'fingerprint' | 'runtime'>): Candidate => ({
  ...candidate,
  runtime: {},
  fingerprint: readFingerprint(candidate.files),
});

/** the server of the entry as it is now: the one that runs when its files did not change, otherwise the definition loaded again, or nothing when its file is gone */
const findCandidate = (source: Configuration['servers'][number], previous: LoadedInstance[]): Candidate[] => {
  const running = previous.find((loaded) => loaded.source === source);

  if (running && readFingerprint(running.files) === running.fingerprint) {
    return [running];
  }

  // a definition in the configuration itself stays as it is, only its workers and lambdas can change
  if (typeof source !== 'string') {
    return [withFingerprint({ source, instance: applyAcmeFiles(source), files: findEntryFiles(source) })];
  }

  const loaded = loadInstanceModule(source);

  if (!loaded) {
    return [];
  }

  // the module as it is given, as it can be reached through a link
  const files = Array.from(new Set([path.resolve(source), ...loaded.files, ...findEntryFiles(loaded.instance)]));

  return [withFingerprint({ source, instance: applyAcmeFiles(loaded.instance), files })];
};

interface Shared {
  workerBudget?: WorkerBudget;
  lambdaStats?: LambdaStats;
  compressionBudget?: CompressionBudget;
  /** the settings the servers are checked against, as a few of them depend on the others (the stats domain) */
  configuration?: Partial<Configuration>;
  /** set in a front process, which runs its share of the limits of the servers */
  front?: FrontShare;
  sharedTargets?: SharedTargets;
}

const start = (candidate: Candidate, previous: LoadedInstance[], logger: Logger, shared: Shared): LoadedInstance => ({
  ...candidate,
  // the definition is kept as it is, the share of the limits is only for what is started
  ...createInstanceHandler(shared.front ? splitServerLimits(candidate.instance, shared.front) : candidate.instance, candidate.runtime, {
    logger,
    ...shared,
    previous: previous.find(({ source }) => source === candidate.source),
  }),
});

/** checks the servers, and in a front that they still run on as many fronts as the server was started with */
const check = (candidates: Candidate[], logger: Logger, { configuration = {}, front }: Shared) => {
  const instances = candidates.map(({ instance }) => instance);
  const frontCount = front ? getFrontCount(configuration, instances) : 1;

  // all the problems at once, before a certificate is read or anything is started
  reportProblems(validateServers(candidates, configuration, frontCount), logger);

  if (front && frontCount !== front.count) {
    throw new FrontCountError(frontCount, front.count);
  }
};

/**
 * The servers of the configuration, keeping the ones of `previous` whose files did not change, with their workers, lambdas and child processes. A server defined in the configuration
 * itself changes with the files of its workers and lambdas.
 * Everything is loaded and checked before anything is started (an error lists every problem of the servers), and what was started is stopped again when a server fails to start: on an error
 * this throws, and the servers of `previous` are left as they are.
 */
const loadInstances = (servers: Configuration['servers'], previous: LoadedInstance[], logger: Logger, shared: Shared = {}): LoadedInstance[] => {
  const candidates = servers.flatMap((source) => findCandidate(source, previous));
  check(candidates, logger, shared);
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
