import { isIP } from 'net';
import isPublicAddress from './is-public-address';
import type { DynamicTargetOptions } from '../types';

type Resolved = { url: URL } | { status: number; error: string };

const isPort = (port: unknown): port is number => Number.isInteger(port) && Number(port) > 0 && Number(port) < 65536;

const toUrl = (body: Record<string, unknown>, clientAddress: string, { protocol = 'http', port }: DynamicTargetOptions): URL | string => {
  if (body.target !== undefined) {
    if (typeof body.target !== 'string' || !URL.canParse(body.target)) return 'The target must be a URL.';

    return new URL(body.target);
  }

  // like the `myip` of dyndns: the service registers itself, from where it calls
  const targetPort = body.port ?? port;
  if (!isPort(targetPort)) return 'A port is needed, in the body or in the configuration of the host.';

  return new URL(`${protocol}://${isIP(clientAddress) === 6 ? `[${clientAddress}]` : clientAddress}:${targetPort}`);
};

/**
 * The target a service registers on the control path of its host: the `target` of the body, or the address it calls from with the `port` of the body or of the
 * configuration. Only http and https to an IP address, which has to be public unless the host allows private ones, so that nobody can aim the proxy at the
 * server itself or the networks behind it. A name is not taken, as what it resolves to can change after the check.
 */
const resolveRegisteredTarget = (body: unknown, clientAddress: string, options: DynamicTargetOptions): Resolved => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { status: 400, error: 'The body must be a JSON object.' };

  const url = toUrl(Object.fromEntries(Object.entries(body)), clientAddress, options);
  if (typeof url === 'string') return { status: 400, error: url };
  if (!['http:', 'https:'].includes(url.protocol)) return { status: 400, error: 'The target must be http or https.' };
  if (url.username || url.password) return { status: 400, error: 'The target must not hold credentials.' };

  const address = url.hostname.replace(/^\[(.*)]$/, '$1');
  if (isIP(address) === 0) return { status: 400, error: 'The target must be an IP address.' };
  if (!options.allowPrivate && !isPublicAddress(address)) return { status: 403, error: 'The target must be a public address.' };

  return { url };
};

export default resolveRegisteredTarget;
