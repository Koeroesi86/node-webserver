import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const EVENT_STARTED = 'LAMBDA_EVENT_STARTED';

export const EVENT_REQUEST = 'LAMBDA_EVENT_REQUEST';

export const EVENT_RESPONSE = 'LAMBDA_EVENT_RESPONSE';

/** how long a lambda may take to load its module and announce itself, in milliseconds, as the init phase of AWS */
export const DEFAULT_START_TIMEOUT = 10 * 1000;

/** how long a lambda may take to answer a request, in milliseconds, the longest that AWS allows */
export const DEFAULT_TIMEOUT = 15 * 60 * 1000;

/** what the lambda process is told about itself, prefixed so that they do not collide with the variables of the lambda */
export const ENV_PATH = 'NODE_LAMBDA_PATH';

export const ENV_HANDLER = 'NODE_LAMBDA_HANDLER';

export const ENV_COMMUNICATION = 'NODE_LAMBDA_COMMUNICATION';

/** the variables of the server that a lambda gets as well: what node and the system need to run it, nothing of the server itself */
export const ALLOWED_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  // windows needs these to start a process, and reads them in any case
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
];
