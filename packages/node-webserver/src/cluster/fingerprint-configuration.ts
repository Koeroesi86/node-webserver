import { createHash } from 'crypto';

/** what JSON has no value for, by its source */
const describe = (_key: string, value: unknown) => (typeof value === 'function' || value instanceof RegExp ? String(value) : value);

/** a hash of the configuration as it was loaded, functions included, to tell whether two processes loaded the same one */
const fingerprintConfiguration = (configuration: object) => createHash('sha1').update(JSON.stringify(configuration, describe)).digest('hex');

export default fingerprintConfiguration;
