import type { Logger } from './logger';

/** how many front processes serve the ports: a number, or `auto` for as many as the cores allow */
export type FrontProcesses = number | 'auto';

/** the place of a front among the fronts of a server, which its share of the limits comes from */
export interface FrontShare {
  /** counted from 0 */
  index: number;
  /** how many fronts the server runs */
  count: number;
}

/** what a server was started from: a front that is started in place of another one has to find the same */
export interface FrontRelease {
  /** of the configuration the front was given */
  configuration: string;
  /** of the package of the server */
  version: string;
}

/** what the primary tells a front when it starts it */
export interface FrontProcess extends FrontShare {
  /** set for a replacement, which ends instead of serving when it finds something else */
  expected?: FrontRelease;
}

/** what the primary sends to a front */
export type PrimaryMessage =
  | { nodeWebserver: 'signal'; signal: NodeJS.Signals }
  | { nodeWebserver: 'reload' }
  /** stop softly and end the process, also without process hooks */
  | { nodeWebserver: 'stop' };

/** what a front sends to the primary */
export type FrontMessage =
  /** the front listens for the messages of the primary from here on */
  | { nodeWebserver: 'hello' }
  /** the servers of the front listen */
  | { nodeWebserver: 'ready'; release: FrontRelease }
  | { nodeWebserver: 'failed'; reason: string }
  /** a replacement that found another configuration or version, and ends */
  | { nodeWebserver: 'stale'; reason: string };

/** a front process as the primary sees it */
export interface FrontHandle {
  pid?: number;
  /** a front that is gone takes no message, which is not an error */
  send: (message: PrimaryMessage) => void;
  /** ends the process at once */
  kill: () => void;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number | null, signal: string | null) => void) => void;
}

/** where the signals that stop or reload a server come from: the process, or in a front the process and the primary together */
export interface SignalSource {
  on: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  once: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  off: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  /** takes its own listeners off the process, so that a signal raised after it ends the process */
  detach?: () => void;
}

/** what `startCluster` resolves to, in the primary, in every front, and for a server that runs in one process */
export interface Cluster {
  /** `single` is a server in this process without a primary, `primary` the process that supervises the fronts, `front` one of them */
  role: 'single' | 'primary' | 'front';
  /** how many fronts serve the ports */
  frontCount: number;
  /** loads the servers again: of every front from the primary, of this one from a front */
  reload: () => void;
  /** stops softly, within `shutdownTimeout`, and resolves once it did: every front from the primary, this one from a front */
  stop: () => Promise<void>;
  /** takes the listeners the server put on the process off again */
  removeProcessHooks: () => void;
}

/** the signals of a front: the ones sent to its process and the ones the primary passes on */
export interface FrontSignals extends Required<SignalSource> {
  /** a signal that the primary passed on */
  receive: (signal: NodeJS.Signals) => void;
}

/** what the listeners of the primary on its process work with */
export interface PrimaryHookOptions {
  reloadOnSighup: boolean;
  shutdownTimeout: number;
  logger: Logger;
  /** passes a message on to every front */
  send: (message: PrimaryMessage) => void;
  /** asks the fronts to leave, kills the ones that are there after `timeout` milliseconds and resolves once all of them ended */
  stop: (message: PrimaryMessage, timeout: number) => Promise<void>;
}
