import http from 'http';
import https from 'https';
import { isIP } from 'net';
import { pipeline } from 'stream';
import type { Socket } from 'net';
import type { Request, Response } from 'express';
import getOutgoingHeaders from './get-outgoing-headers';
import type { ProxyRequestOptions, ProxyTarget } from '../types';

const isUpgrade = (request: Request) =>
  Boolean(request.headers.upgrade) &&
  `${request.headers.connection ?? ''}`
    .toLowerCase()
    .split(',')
    .some((token) => token.trim() === 'upgrade');

/** an answer of the proxy itself, or the end of a response that is already on its way, which can only be cut */
const fail = (response: Response, status: number, message: string) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.status(status).type('text/plain').send(message);
};

/** the client and the target exchange what they send from now on, as for a websocket, until either of them closes */
const connect = (client: Socket, target: Socket, head: Buffer) => {
  target.setTimeout(0);
  // the server closes a connection that stays quiet for its keep alive timeout, which is not the idle time of a websocket
  client.setTimeout(0);
  if (head.length > 0) client.write(head);
  target.pipe(client).pipe(target);
  target.on('error', () => client.destroy());
  client.on('error', () => target.destroy());
  target.on('close', () => client.destroy());
  client.on('close', () => target.destroy());
};

/**
 * Sends a request to the target of a proxy and its answer back: 502 when the target cannot be reached, 504 when it stays silent for the timeout, and the request
 * to the target is aborted when the client goes away. An upgrade (a websocket) the target accepts connects the client to it.
 */
const proxyRequest = (
  request: Request,
  response: Response,
  { url, agent }: ProxyTarget,
  { changeOrigin = false, hideHeaders = [], timeout }: ProxyRequestOptions
) => {
  const upgrade = isUpgrade(request);
  // the host of the target with changeOrigin, and the upgrade of the client, are the only headers of the connection that go on
  const headers = [
    ...getOutgoingHeaders(request.headers, changeOrigin ? ['host'] : []),
    ...(changeOrigin ? ['host', url.host] : []),
    ...(upgrade ? ['connection', 'Upgrade', 'upgrade', `${request.headers.upgrade}`] : []),
  ];
  // the brackets of an IPv6 address are part of the URL, not of the address
  const hostname = url.hostname.replace(/^\[(.*)]$/, '$1');
  let timedOut = false;

  const options: https.RequestOptions = {
    hostname,
    port: url.port || undefined,
    method: request.method,
    path: `${url.pathname.replace(/\/$/, '')}${request.originalUrl}`,
    headers,
    agent,
  };
  const outgoing =
    url.protocol === 'https:'
      ? // the name of the target, not the one of the client, for the certificate to be checked against
        https.request({ ...options, servername: isIP(hostname) ? undefined : hostname })
      : http.request(options);

  outgoing.setTimeout(timeout, () => {
    timedOut = true;
    outgoing.destroy();
  });
  outgoing.on('error', () =>
    timedOut
      ? fail(response, 504, 'The server behind this host did not answer in time.')
      : fail(response, 502, 'The server behind this host cannot be reached.')
  );
  outgoing.on('response', (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, getOutgoingHeaders(incoming.headers, hideHeaders));
    // an error on either side ends both, there is nothing left to answer
    pipeline(incoming, response, () => undefined);
  });
  outgoing.on('upgrade', (incoming, socket, head) => {
    response.writeHead(101, incoming.statusMessage, [
      ...getOutgoingHeaders(incoming.headers, hideHeaders),
      'connection',
      'Upgrade',
      'upgrade',
      `${incoming.headers.upgrade}`,
    ]);
    response.end();
    connect(request.socket, socket, head);
  });
  response.on('close', () => {
    if (!response.writableFinished) outgoing.destroy();
  });

  if (upgrade) {
    outgoing.end();
    return;
  }

  request.on('error', () => outgoing.destroy());
  request.pipe(outgoing);
};

export default proxyRequest;
