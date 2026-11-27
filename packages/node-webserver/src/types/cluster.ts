import type { Logger } from './logger';
import type { CertificateServer, ChallengeStore } from './acme';
import type { ConfigurationProblem } from './problem';
import type { PortLookup } from './configuration';
import type { TargetChange } from './proxy';

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
  /** set for a process that only says what a server of the configuration as it is now would be, and ends */
  plan?: boolean;
}

/** the settings of a server that its primary uses itself */
export interface PrimarySettings {
  reloadOnSighup: boolean;
  shutdownTimeout: number;
  watchServers: boolean;
}

/** what a server of a configuration would be: what the primary needs to start its fronts, or to decide what a change of it takes */
export interface ServerPlan {
  /** everything wrong with the configuration and the server files */
  problems: ConfigurationProblem[];
  frontCount: number;
  /** whether the primary accepts the connections (several fronts are asked for, or it is Windows), which cannot change while it runs */
  balanced: boolean;
  release: FrontRelease;
  /** the file of the configuration and the files it loads, none when the primary was not given the file */
  files: string[];
  /** of the content of the files */
  filesFingerprint?: string;
  settings: PrimarySettings;
}

/** the servers a front runs: the files whose change the primary watches for, and a fingerprint of what was loaded, the same in fronts that loaded the same */
export interface LoadReport {
  files: string[];
  fingerprint: string;
  /** what the targets of the servers with a dynamic one are known by */
  targets: string[];
  /** the `acme` servers */
  certificates: CertificateServer[];
}

/** what the primary sends to a front */
export type PrimaryMessage =
  | { nodeWebserver: 'signal'; signal: NodeJS.Signals }
  /** load the servers and start what is new, without serving from it */
  | { nodeWebserver: 'prepare'; round: number }
  /** serve what was prepared in the round, and retire what it replaces */
  | { nodeWebserver: 'commit'; round: number }
  /** close what was prepared in the round, and keep serving */
  | { nodeWebserver: 'discard'; round: number }
  /** stop softly and end the process, also without process hooks */
  | { nodeWebserver: 'stop' }
  /** registered targets: all of them as the answer to `hello`, which a front waits for before it serves, and afterwards the ones that changed */
  | { nodeWebserver: 'targets'; changes: TargetChange[] }
  /** the answer to a challenge of the certificate authority, which every front gives until the message without one */
  | { nodeWebserver: 'challenge'; token: string; answer?: string }
  /** the port of an application of a `child` server that the front claimed, or why it has none */
  | { nodeWebserver: 'app-port'; key: string; port?: number; error?: string }
  /** the processes of the applications that run: for the stats of the fronts, which end them when they find the primary gone */
  | { nodeWebserver: 'apps'; running: RunningApp[] };

/** an application of a `child` server that runs */
export interface RunningApp {
  key: string;
  pid: number;
}

/** what a front sends to the primary about the loading of its servers */
export type FrontReloadMessage =
  | { nodeWebserver: 'prepared'; round: number; fingerprint: string }
  /** `recount` for servers that would run on another number of fronts, which takes new ones */
  | { nodeWebserver: 'prepare-failed'; round: number; reason: string; recount?: boolean }
  /** the files to watch, after every load */
  | ({ nodeWebserver: 'files' } & Omit<LoadReport, 'fingerprint'>)
  /** something in the front asks for the servers to be loaded again */
  | { nodeWebserver: 'reload-request' };

/** what a front sends to the primary about what that keeps for all fronts */
export type FrontServiceMessage =
  /** what was registered with, or removed from, a server of the front */
  | { nodeWebserver: 'target'; change: TargetChange }
  /** the front has the challenge it was told */
  | { nodeWebserver: 'challenge-taken'; token: string }
  /** a server of the front wants the application, on the port of its configuration or one the primary picks from `lookup` */
  | { nodeWebserver: 'app-claim'; key: string; port?: number; lookup?: PortLookup }
  /** what to start for the application, on the port the front was told */
  | { nodeWebserver: 'app-start'; key: string; command: string; args: string[] }
  /** no server of the front wants the application any more */
  | { nodeWebserver: 'app-release'; key: string };

/** what a front sends to the primary */
export type FrontMessage =
  /** the front listens for the messages of the primary from here on */
  | { nodeWebserver: 'hello' }
  /** the servers of the front listen */
  | ({ nodeWebserver: 'ready'; release: FrontRelease } & LoadReport)
  | { nodeWebserver: 'failed'; reason: string }
  /** a replacement that found another configuration or version, and ends */
  | { nodeWebserver: 'stale'; reason: string }
  | { nodeWebserver: 'plan'; plan: ServerPlan }
  | FrontServiceMessage
  | FrontReloadMessage;

/** what is told about the fronts of a server as they serve, say something about their servers, and end */
export interface FrontListener {
  serving: (index: number, report: LoadReport) => void;
  message: (index: number, message: FrontReloadMessage) => void;
  exited: (index: number) => void;
}

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

/** what the primary keeps, or does, for all its fronts */
export interface FrontService {
  /** for a front that is started, which the messages of the primary reach through `send` */
  join: (send: (message: PrimaryMessage) => void) => FrontMember;
}

/** a front as a service of the primary knows it */
export interface FrontMember {
  /** the front listens: tells it what it starts with */
  hello: () => void;
  /** a message of the front, which the services take that it is for */
  receive: (message: FrontServiceMessage) => void;
  /** what the servers of the front are now */
  serves: (report: Pick<LoadReport, 'targets' | 'certificates'>) => void;
  leave: () => void;
}

/** the certificates of the `acme` servers, as the primary keeps track of them */
export interface CertificateRegistry extends FrontService {
  /** of all fronts, one for each certificate */
  getServers: () => CertificateServer[];
  /** every front gets what is set */
  challenges: ChallengeStore;
}

/** the applications of the `child` servers, as the primary runs them for its fronts */
export interface AppRegistry extends FrontService {
  /** ends all of them, for good */
  stop: () => void;
}

/** the applications of the `child` servers that all fronts of a server share, as one of them sees them */
export interface SharedApps {
  /** resolves with the port the application is to be reached on */
  claim: (key: string, wanted: { port?: number; lookup?: PortLookup }) => Promise<number>;
  start: (key: string, command: string, args: string[]) => void;
  release: (key: string) => void;
  /** of the application while it runs */
  pid: (key: string) => number | undefined;
}

/** how the launcher started the server: for the first time, or again after the server asked for it */
export type LauncherMode = 'start' | 'restart';

/** what the primary sends to the launcher that started it */
export type ServerMessage =
  /** the server listens for the messages of the launcher from here on */
  | { nodeWebserver: 'hello' }
  /** all fronts serve */
  | { nodeWebserver: 'serving' };

/** where the signals that stop or reload a server come from: the process, or the process and the channel to the primary or the launcher together */
export interface SignalSource {
  on: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  once: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  off: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  /** takes its own listeners off the process, so that a signal raised after it ends the process */
  detach?: () => void;
}

/** what `startCluster` resolves to, in the primary, in every front, and for a server that runs in one process */
export interface Cluster {
  /** `primary` is the process that supervises the fronts, `front` one of them */
  role: 'primary' | 'front';
  /** how many fronts serve the ports */
  frontCount: number;
  /** loads the servers again, of every front together, whether it is asked of the primary or of a front. A change of the configuration is applied by it too. */
  reload: () => void;
  /** stops softly, within `shutdownTimeout`, and resolves once it did: every front from the primary, this one from a front */
  stop: () => Promise<void>;
  /** takes the listeners the server put on the process off again */
  removeProcessHooks: () => void;
}

/** the signals sent to a process and the ones passed on to it over a channel */
export interface MergedSignals extends Required<SignalSource> {
  /** a signal that came over the channel */
  receive: (signal: NodeJS.Signals) => void;
}

/** what the listeners of the primary on its process work with */
export interface PrimaryHookOptions {
  /** the process by default, the process and the launcher for a server that was launched */
  signals?: SignalSource;
  /** of the configuration the server runs now, which a change of it changes */
  settings: () => PrimarySettings;
  logger: Logger;
  /** loads the configuration and the servers again */
  reload: () => void;
  /** asks the fronts to leave, kills the ones that are there after `timeout` milliseconds and resolves once all of them ended */
  stop: (message: PrimaryMessage, timeout: number) => Promise<void>;
}

/** what a change of the configuration takes */
export type Decision = { action: 'keep' } | { action: 'invalid' } | { action: 'switch' } | { action: 'restart'; reason: string };

/** what a set of fronts is made of */
export interface FrontSetOptions {
  plan: ServerPlan;
  fork: (front: FrontProcess) => FrontHandle;
  logger: Logger;
  /** shared with the other sets of fronts */
  services: FrontService;
  /** watches the files of the servers, for a set whose configuration asks for it */
  watch?: (files: string[], onChange: () => void) => () => void;
  /** a front could not take the place of another one, as it found something else */
  onStale: () => void;
  /** the servers would run on another number of fronts now */
  onRecount: () => void;
}

/** a set of fronts as the manager of them sees it */
export interface ManagedSet {
  start: () => Promise<void>;
  stop: (message: PrimaryMessage, timeout: number) => Promise<void>;
  reload: () => void;
  isEmpty: () => boolean;
}

export interface ClusterOptions {
  /** whether the server stops softly on the signals, stops its children and workers when the process ends and flushes the logger then. Defaults to true. False leaves all of it to the caller. */
  processHooks?: boolean;
  /**
   * the file the configuration was loaded from, with `require`, in the script that calls this, which the primary then watches: a change of it, or of a file it loads, is applied.
   * The script has to load it again every time it runs.
   */
  configurationFile?: string;
}
