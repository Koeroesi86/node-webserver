import http from 'http';
import https from 'https';
import type { ProxyTarget } from '../types';

/** a target of a proxy, with an agent of its own that keeps the connections to it open */
const createProxyTarget = (url: URL, { secure = true, ca }: { secure?: boolean; ca?: string } = {}, expiresAt?: number): ProxyTarget => ({
  url,
  agent: url.protocol === 'https:' ? new https.Agent({ keepAlive: true, rejectUnauthorized: secure, ca }) : new http.Agent({ keepAlive: true }),
  setAt: Date.now(),
  expiresAt,
});

export default createProxyTarget;
