import { isIPv6 } from 'net';
import type { Request } from 'express';

/**
 * The address of the client: the peer of the connection, or, when the peer is a trusted proxy, the address `request.ip` takes from `X-Forwarded-For` (the
 * `trust proxy` setting of the app). Headers a client sets itself are never believed. An IPv4 address on a dual stack socket (`::ffff:1.2.3.4`) is given as IPv4.
 */
const getClientIp = (request: Request): string => {
  const address = request.ip ?? request.socket?.remoteAddress ?? '';

  return isIPv6(address) && address.toLowerCase().startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address;
};

export default getClientIp;
