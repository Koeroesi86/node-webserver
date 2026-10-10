import type { Request } from 'express';
import unmapAddress from './unmap-address';

/**
 * The address of the client: the peer of the connection, or, when the peer is a trusted proxy, the first address of `X-Forwarded-For` from the right that is
 * not trusted itself (`trust proxy` of express, set from `trustedProxies`). Headers a client sets itself are never believed.
 */
const getClientAddress = (request: Request): string => unmapAddress(request.ip ?? request.socket.remoteAddress ?? '');

export default getClientAddress;
