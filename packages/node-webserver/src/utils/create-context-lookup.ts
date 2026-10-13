import type { SecureContext } from 'tls';
import getHostPattern from './get-host-pattern';

export interface HostContext {
  hostname: string;
  secureContext: SecureContext | undefined;
}

/**
 * Looks up the certificate for the name a client asks for, the way the virtual host router matches hosts: an exact name first, which costs the same with
 * any number of hosts, then the hosts with wildcards in the order of the configuration.
 */
const createContextLookup = (hosts: HostContext[]): ((domain: string) => SecureContext | undefined) => {
  const withContext = hosts.filter(({ secureContext }) => secureContext);
  const exact = new Map(
    withContext.filter(({ hostname }) => !hostname.includes('*')).map(({ hostname, secureContext }) => [hostname.toLowerCase(), secureContext])
  );
  const patterns = withContext
    .filter(({ hostname }) => hostname.includes('*'))
    .map(({ hostname, secureContext }) => ({ pattern: getHostPattern(hostname), secureContext }));

  return (domain) => exact.get(domain.toLowerCase()) ?? patterns.find(({ pattern }) => pattern.test(domain))?.secureContext;
};

export default createContextLookup;
