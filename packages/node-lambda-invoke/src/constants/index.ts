import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const EVENT_STARTED = 'LAMBDA_EVENT_STARTED';

export const EVENT_REQUEST = 'LAMBDA_EVENT_REQUEST';

export const EVENT_RESPONSE = 'LAMBDA_EVENT_RESPONSE';
