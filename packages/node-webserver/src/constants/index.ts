import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
};

/** a year in seconds, what `hsts: true` sends and the least that preload lists ask for */
export const DEFAULT_HSTS_MAX_AGE = 31536000;

export const PROXY_PROTOCOLS: Record<string, string> = {
  http: 'http',
  https: 'http',
  ws: 'ws',
  wss: 'ws',
};

/**
 * Node closes an idle keep-alive connection after 5 seconds, which is shorter than what load balancers and proxies keep theirs for (60 seconds is common),
 * and they then send a request on a connection that has just been closed. Longer than their timeout avoids that.
 */
export const DEFAULT_KEEP_ALIVE_TIMEOUT = 65000;

/** the open connections of a server after which new ones are dropped, 0 for no limit */
export const DEFAULT_MAX_CONNECTIONS = 10000;

/** how long the primary waits for its fronts to take a challenge before it asks the authority to check it, in milliseconds */
export const CHALLENGE_TIMEOUT = 5000;

/** the path of a `proxy` host with a dynamic target that the server answers itself, for the service to register its target */
export const DEFAULT_CONTROL_PATH = '/.well-known/node-webserver/proxy';

/** how long a `proxy` server waits for its target to answer, or to send more of the answer, before it answers 504, in milliseconds */
export const DEFAULT_PROXY_TIMEOUT = 60000;

/** the control path of a host takes this many updates, and this many failed attempts from one address, per window */
export const CONTROL_RATE_WINDOW = 60000;
export const CONTROL_UPDATES_PER_WINDOW = 10;
export const CONTROL_FAILURES_PER_WINDOW = 10;

/** the largest body the control path reads, in bytes: it only ever holds a target */
export const CONTROL_BODY_LIMIT = 4096;

/** headers of one connection, which a proxy does not pass on (RFC 9110 7.6.1), `expect` included as the server already answered it */
export const HOP_BY_HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect'];

/** headers that name the client, which only a trusted proxy may set */
export const CLIENT_ADDRESS_HEADERS = ['x-real-ip', 'x-client-ip', 'cf-connecting-ip'];

/** how long the files of the servers have to be quiet after a change before they are loaded again, as saving a file can be several writes */
export const RELOAD_DEBOUNCE = 100;

/** how long a server that was removed or changed may take to answer the requests it had, in milliseconds, before what runs behind it is stopped anyway */
export const RETIRE_TIMEOUT = 30000;

/** how long a stop of the process (SIGINT, SIGTERM, SIGHUP) waits for the requests in flight, in milliseconds, before the rest is cut */
export const DEFAULT_SHUTDOWN_TIMEOUT = 30000;

/** a log buffer that grows beyond this many characters is written right away */
export const LOG_MAX_BUFFER_SIZE = 64 * 1024;

/** log lines are dropped, and counted, once this many characters wait because the disk does not keep up, so the memory cannot grow without a limit */
export const LOG_MAX_QUEUE_SIZE = 16 * 1024 * 1024;

/** the content types worth compressing: text like ones, and fonts and documents that are not compressed in themselves */
export const COMPRESSIBLE_TYPES =
  /^(text\/|application\/(json|(x-)?javascript|xml|wasm|manifest\+json|.+\+(json|xml))|image\/svg\+xml|font\/(ttf|otf)|application\/vnd\.ms-fontobject)/i;

/** the statuses that have no body to compress */
export const BODYLESS_STATUSES = [204, 205, 304];

/** a certificate that expires within this many days is reported, so that it is renewed before the clients notice */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 14;

/** the directory of Let's Encrypt that `acme` uses unless it names another */
export const ACME_DEFAULT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory';

/** how often the certificates of the `acme` servers are looked at, in milliseconds. A failed order is tried again at the next look. */
export const ACME_CHECK_INTERVAL = 60 * 60 * 1000;

/** RFC 8555 6.1 asks for a User-Agent in every request, and Pebble answers 400 without one */
export const ACME_USER_AGENT = '@koeroesi86/node-webserver';

/** how long a request to the ACME server may take, in milliseconds */
export const ACME_REQUEST_TIMEOUT = 30000;

/** the content type of a page by its extension, for the files of `errorPages` and `unknownHostPage`; anything else is plain text */
export const PAGE_TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json' };

/** the most front processes a server runs: with more of them the throughput got worse where it was measured */
export const MAX_FRONT_PROCESSES = 4;

/** the environment variable a front is told its place among the fronts in */
export const FRONT_PROCESS_ENV = 'NODE_WEBSERVER_FRONT';

/** a front that ends sooner than this after it started counts towards the delay of the next replacement, in milliseconds, as a worker that crashes does */
export const FRONT_MIN_UPTIME = 5000;

/** a front that ended too soon twice in a row is replaced after this long, doubling with every further time until the maximum, in milliseconds */
export const FRONT_RESTART_BACKOFF = { base: 100, max: 10000 };

/** how much longer than it was asked to take the primary waits for a front to stop before it kills it, in milliseconds */
export const FRONT_STOP_MARGIN = 2000;

/** how far apart the same signal from the process and from the primary still counts as one, in milliseconds */
export const SIGNAL_PAIR_WINDOW = 2000;

/** how long a front may take to load its servers for a reload before it is replaced, in milliseconds */
export const RELOAD_ROUND_TIMEOUT = 30000;

/** how often a reload is tried again at once when the fronts did not load the same, as files were being written, before it waits for the next change */
export const RELOAD_ROUND_RETRIES = 3;

/** the exit code a server ends with for its launcher to start it again, which any other end is passed on as */
export const RESTART_EXIT_CODE = 75;

/** the environment variable the launcher tells the server in how it started it */
export const LAUNCHER_ENV = 'NODE_WEBSERVER_LAUNCHER';

/** how long the process that loads a changed configuration may take before it is given up on, in milliseconds */
export const PLAN_TIMEOUT = 30000;
