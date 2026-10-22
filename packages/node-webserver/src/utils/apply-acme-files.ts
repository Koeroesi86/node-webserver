import getAcmeFiles from './get-acme-files';
import type { ServerConfig } from '../types';

/** the server with the files of its key and certificate set, for the steps that read them. A server whose settings are not usable is left as it is, for the checks to name. */
const applyAcmeFiles = (instance: ServerConfig): ServerConfig =>
  typeof instance.acme?.storagePath === 'string' && typeof instance.hostname === 'string' ? { ...instance, ...getAcmeFiles(instance) } : instance;

export default applyAcmeFiles;
