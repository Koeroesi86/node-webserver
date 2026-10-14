import type { Express } from 'express';
import type { Configuration } from '../types';

/** Sets the proxies whose forwarding headers are believed per protocol, before the hosts are set up, as the client address and the protocol of every request depend on it. */
const applyTrustedProxies = (trustedProxies: NonNullable<Configuration['trustedProxies']>, httpApps: Express[], httpsApps: Express[]) => {
  const forProtocol = (protocol: 'http' | 'https') => (Array.isArray(trustedProxies) ? trustedProxies : (trustedProxies[protocol] ?? []));

  httpApps.forEach((app) => app.set('trust proxy', forProtocol('http')));
  httpsApps.forEach((app) => app.set('trust proxy', forProtocol('https')));
};

export default applyTrustedProxies;
