import type { RequestHandler } from 'express';
import type { ProxyTarget } from './proxy';
import type { ServerConfig, ServerRuntime } from './server';

/** what answers the requests of a server */
export interface InstanceHandler {
  handler: RequestHandler;
  /** stops what the server started once it answered the requests it took, or after `timeout` milliseconds, and resolves once it did */
  close: (timeout: number) => Promise<void>;
  /** the target that was registered with a `proxy` server, which the server that replaces it takes over */
  registeredTarget?: () => ProxyTarget | undefined;
}

/** a server of the configuration with what it gets while it runs, which the setup steps set on `runtime` and never on the definition */
export interface ServerState {
  instance: ServerConfig;
  runtime: ServerRuntime;
}

/** a server of the configuration as it runs */
export interface LoadedInstance extends InstanceHandler, ServerState {
  /** the entry of `servers` it comes from */
  source: string | ServerConfig;
  /** the files it was loaded from, the module and the ones it loaded, empty for a server defined in the configuration itself */
  files: string[];
  /** of the content of the files, to tell whether they changed */
  fingerprint?: string;
}
