import type { Request } from 'express';
import { CLIENT_ADDRESS_HEADERS } from '../constants';
import unmapAddress from './unmap-address';
import type { ForwardedHeaders } from '../types';

const forwardingHeaders = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', ...CLIENT_ADDRESS_HEADERS];

const isPeerTrusted = (request: Request, peer: string) => {
  const trust: ((address: string, index: number) => boolean) | undefined = request.app.get('trust proxy fn');

  return Boolean(trust?.(peer, 0));
};

/** the forwarding headers of a request on its way to the target of a proxy, see `ForwardedHeaders` */
const setForwardedHeaders = (request: Request, mode: ForwardedHeaders = 'sanitize') => {
  const { headers } = request;

  if (mode === 'pass') return;

  if (mode === 'none') {
    forwardingHeaders.forEach((name) => delete headers[name]);
    return;
  }

  const peer = request.socket.remoteAddress ?? '';
  const hop = unmapAddress(peer);

  if (isPeerTrusted(request, peer)) {
    // a load balancer: its chain is kept, and it is the next hop of it
    const chain = headers['x-forwarded-for'];
    headers['x-forwarded-for'] = chain ? `${chain}, ${hop}` : hop;
    headers['x-forwarded-proto'] ??= request.protocol;
    headers['x-forwarded-host'] ??= headers.host;
    return;
  }

  // a client: whatever it says about itself is replaced by the connection
  forwardingHeaders.forEach((name) => delete headers[name]);
  headers['x-forwarded-for'] = hop;
  headers['x-forwarded-proto'] = request.protocol;
  if (headers.host) headers['x-forwarded-host'] = headers.host;
};

export default setForwardedHeaders;
