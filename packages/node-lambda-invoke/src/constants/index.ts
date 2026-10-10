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

/** the folder the `file` communication keeps the requests and responses of a lambda in */
export const ENV_STORAGE_FOLDER = 'NODE_LAMBDA_STORAGE_FOLDER';

/** how long a lambda process lives at the longest, a safety net for when the server does not stop it */
export const ENV_MAX_LIFETIME = 'NODE_LAMBDA_MAX_LIFETIME';

/** the folders of the lambda processes are named like this, followed by the process id of the server that started them */
export const LAMBDA_FOLDER_PREFIX = 'node-lambda-';

/** a lambda is stopped after this long, AWS has no fixed clock but a function does not run for ever */
export const LIFESPAN = 15 * 60 * 1000;

/** a lambda is not handed out any more after this long, and stopped when it is idle, so that it is not killed halfway through a request */
export const DRAIN_AFTER = 14.5 * 60 * 1000;

/** how long a lambda gets to stop after it was asked to, in milliseconds */
export const STOP_GRACE = 5000;

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

/** the bodies API Gateway answers with when the integration fails, so that clients of a lambda see what they see on AWS */
export const MESSAGE_INTERNAL_SERVER_ERROR = 'Internal server error';

export const MESSAGE_ENDPOINT_TIMED_OUT = 'Endpoint request timed out';

export const MESSAGE_SERVICE_UNAVAILABLE = 'Service Unavailable';

export const MESSAGE_PAYLOAD_TOO_LARGE = 'Request Entity Too Large';

/** the largest payload of a synchronous invocation of AWS, in bytes */
export const DEFAULT_LIMIT_REQUEST_BODY = 6 * 1024 * 1024;
