import type { RequestHandler } from 'express';
import type { SecureContext } from 'tls';
import { RETIRE_TIMEOUT, RELOAD_DEBOUNCE } from '../constants';
import type { Configuration, LoadedInstance, ServerInstance } from '../types';
import createContextLookup from './create-context-lookup';
import debounce from './debounce';
import getDate from './getDate';
import getWatchedFiles from './get-watched-files';
import logger from './logger';
import setupVirtualHosts from './setupVirtualHosts';
import watchFiles from './watch-files';

type InstanceLoader = (previous: LoadedInstance[]) => LoadedInstance[];

interface ServerReloader {
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerInstance[];
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
  loadInstances: InstanceLoader
): ServerReloader => {
  let loaded: LoadedInstance[] = [];
  let hosts = setupVirtualHosts([], configuration);
  let findSecureContext: (domain: string) => SecureContext | undefined = () => undefined;
  const retiring = new Set<LoadedInstance>();
  let stopWatching = () => {};

  const apply = (next: LoadedInstance[]) => {
    const added = next.filter((instance) => !loaded.includes(instance));
    const removed = loaded.filter((instance) => !next.includes(instance));

    hosts = setupVirtualHosts(next, configuration);
    findSecureContext = createContextLookup(
      next
        .filter(({ instance }) => instance.protocol === 'https')
        .map(({ instance }) => ({ hostname: instance.hostname, secureContext: instance.secureContext }))
    );
    loaded = next;

    added.forEach(({ instance }) => logger.system(`[${getDate()}] Server started for ${instance.url}`));
    removed.forEach((instance) => {
      retiring.add(instance);
      instance.close(RETIRE_TIMEOUT).finally(() => retiring.delete(instance));
    });

    return { added, removed };
  };

  const watch = () => {
    stopWatching();
    stopWatching = watchFiles(getWatchedFiles(servers, loaded), debounce(reload, RELOAD_DEBOUNCE));
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
    getInstances: () => [...loaded, ...retiring].map(({ instance }) => instance),
    httpHandler,
    httpsHandler,
    findContext: (domain) => findSecureContext(domain),
    reload,
    watch,
  };
};

export default createServerReloader;
