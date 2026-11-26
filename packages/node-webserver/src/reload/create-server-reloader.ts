import type { RequestHandler } from 'express';
import type { SecureContext } from 'tls';
import { RETIRE_TIMEOUT, RELOAD_DEBOUNCE } from '../constants';
import type { Configuration, LoadedInstance, Logger, PreparedServers, ServerState } from '../types';
import { createContextLookup } from '../tls';
import { debounce, getDate } from '../utils';
import getWatchedFiles from './get-watched-files';
import { setupVirtualHosts } from '../routing';
import watchFiles from './watch-files';

type InstanceLoader = (previous: LoadedInstance[]) => LoadedInstance[];

interface ServerReloader {
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerState[];
  httpHandler: RequestHandler;
  httpsHandler: RequestHandler;
  findContext: (domain: string) => SecureContext | undefined;
  reload: () => void;
  /** loads the servers and starts what is new, to serve it when `commit` is called. Throws as a load does, with the running servers left as they are. */
  prepare: () => PreparedServers;
  /** the files a change of which changes the servers that run */
  getWatchedFiles: () => string[];
  watch: () => void;
}

const createServerReloader = (
  servers: Configuration['servers'],
  configuration: Partial<Configuration>,
  watchServers: boolean,
  loadInstances: InstanceLoader,
  logger: Logger
): ServerReloader => {
  let loaded: LoadedInstance[] = [];
  let hosts = setupVirtualHosts([], configuration, logger);
  let findSecureContext: (domain: string) => SecureContext | undefined = () => undefined;
  const retiring = new Set<LoadedInstance>();
  /** started and not serving yet */
  const preparing = new Set<LoadedInstance>();
  let stopWatching = () => {};

  const apply = (next: LoadedInstance[]) => {
    const added = next.filter((instance) => !loaded.includes(instance));
    const removed = loaded.filter((instance) => !next.includes(instance));

    hosts = setupVirtualHosts(next, configuration, logger);
    findSecureContext = createContextLookup(
      next
        .filter(({ instance }) => instance.protocol === 'https')
        .map(({ instance, runtime }) => ({ hostname: instance.hostname, secureContext: runtime.secureContext }))
    );
    loaded = next;

    added.forEach(({ runtime }) => logger.system(`[${getDate()}] Server started for ${runtime.url}`));
    removed.forEach((instance) => retire(instance, RETIRE_TIMEOUT));

    return { added, removed };
  };

  const retire = (instance: LoadedInstance, timeout: number) => {
    retiring.add(instance);
    instance.close(timeout).finally(() => retiring.delete(instance));
  };

  const prepare = (): PreparedServers => {
    const instances = loadInstances(loaded);
    const started = instances.filter((instance) => !loaded.includes(instance));
    started.forEach((instance) => preparing.add(instance));
    const settle = () => started.forEach((instance) => preparing.delete(instance));

    return {
      instances,
      commit: () => {
        settle();
        const { added, removed } = apply(instances);
        logger.system(`[${getDate()}] Servers loaded again: ${added.length} started, ${removed.length} stopped once their requests are answered`);
      },
      discard: () => {
        settle();
        started.forEach((instance) => retire(instance, 0));
      },
    };
  };

  const watched = () => getWatchedFiles(servers, loaded, configuration.unknownHostPage);

  const watch = () => {
    const stopPrevious = stopWatching;
    // the new watchers before the old ones are closed: a change that has not been delivered yet would be dropped with the last watcher of its folder
    stopWatching = watchFiles(watched(), debounce(reload, RELOAD_DEBOUNCE));
    stopPrevious();
  };

  const reload = () => {
    try {
      prepare().commit();
    } catch (error) {
      logger.error(`[${getDate()}] The servers were not loaded again, the running ones are kept:`, error);
    }

    // the files of the servers can be others now
    if (watchServers) watch();
  };

  apply(loadInstances([]));
  const httpHandler: RequestHandler = (request, response, next) => hosts.http(request, response, next);
  const httpsHandler: RequestHandler = (request, response, next) => hosts.https(request, response, next);

  return {
    getLoaded: () => loaded,
    getInstances: () => [...loaded, ...preparing, ...retiring],
    httpHandler,
    httpsHandler,
    findContext: (domain) => findSecureContext(domain),
    reload,
    prepare,
    getWatchedFiles: watched,
    watch,
  };
};

export default createServerReloader;
