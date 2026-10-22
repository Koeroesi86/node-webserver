import type { RequestHandler } from 'express';
import type { SecureContext } from 'tls';
import { RETIRE_TIMEOUT, RELOAD_DEBOUNCE } from '../constants';
import type { Configuration, LoadedInstance, Logger, ServerState } from '../types';
import createContextLookup from './create-context-lookup';
import debounce from './debounce';
import getDate from './get-date';
import getWatchedFiles from './get-watched-files';
import setupVirtualHosts from './setup-virtual-hosts';
import watchFiles from './watch-files';

type InstanceLoader = (previous: LoadedInstance[]) => LoadedInstance[];

interface ServerReloader {
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerState[];
  httpHandler: RequestHandler;
  httpsHandler: RequestHandler;
  findContext: (domain: string) => SecureContext | undefined;
  reload: () => void;
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
    removed.forEach((instance) => {
      retiring.add(instance);
      instance.close(RETIRE_TIMEOUT).finally(() => retiring.delete(instance));
    });

    return { added, removed };
  };

  const watch = () => {
    stopWatching();
    stopWatching = watchFiles(getWatchedFiles(servers, loaded, configuration.unknownHostPage), debounce(reload, RELOAD_DEBOUNCE));
  };

  const reload = () => {
    try {
      const { added, removed } = apply(loadInstances(loaded));
      logger.system(`[${getDate()}] Servers loaded again: ${added.length} started, ${removed.length} stopped once their requests are answered`);
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
    getInstances: () => [...loaded, ...retiring],
    httpHandler,
    httpsHandler,
    findContext: (domain) => findSecureContext(domain),
    reload,
    watch,
  };
};

export default createServerReloader;
