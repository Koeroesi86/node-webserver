import path from 'path';
import type { ServerConfig } from '../types';

/** where the key and the certificate of an `acme` server are: the files it names, otherwise the ones in the folder for its host name */
const getAcmeFiles = ({ hostname, key, cert, acme }: Pick<ServerConfig, 'hostname' | 'key' | 'cert' | 'acme'>) => {
  const folder = path.join(acme?.storagePath ?? '', hostname);

  return { key: key ?? path.join(folder, 'privkey.pem'), cert: cert ?? path.join(folder, 'fullchain.pem') };
};

export default getAcmeFiles;
