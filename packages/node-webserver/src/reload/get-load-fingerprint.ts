import { createHash } from 'crypto';
import type { LoadedInstance } from '../types';
import readFingerprint from './read-fingerprint';

/** the files that are read when servers are loaded and are not part of the check for a change of a server: certificates and pages */
const getAssets = ({ instance: { key, cert, ca, errorPages } }: LoadedInstance) => [key, cert, ca, ...Object.values(errorPages ?? {})];

/**
 * A fingerprint of what the servers were loaded from: of every server the one of its files, and the content of the certificates and pages.
 * Processes that loaded the same have the same one, a file that was being written while one of them read it makes it differ.
 */
const getLoadFingerprint = (loaded: LoadedInstance[], unknownHostPage?: string) => {
  const assets = [...loaded.flatMap(getAssets), unknownHostPage].filter((file): file is string => typeof file === 'string');
  const servers = loaded.map(({ source, instance, fingerprint }) => [typeof source === 'string' ? source : instance.hostname, fingerprint]);

  return createHash('sha1')
    .update(JSON.stringify([servers, assets.map((file) => [file, readFingerprint([file])])]))
    .digest('hex');
};

export default getLoadFingerprint;
