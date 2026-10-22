import type { RequestHandler } from 'express';
import createHttpsRedirect from './create-https-redirect';
import getURL from './get-url';
import virtualHostRouter from './virtual-host-router';
import getDate from './get-date';
import createMisdirectedHandler from './create-misdirected-handler';
import type { Configuration, Logger, ServerState } from '../types';
import type { VirtualHost } from '../types/virtual-host';

interface StartedHost extends ServerState {
  handler: RequestHandler;
}

/** the handler of the http server and the one of the https server, which pass every request to the server of its host name */
function setupVirtualHosts(hosts: StartedHost[], Configuration: Partial<Configuration>, logger: Logger): Record<'http' | 'https', RequestHandler> {
  const { portHttp, portHttps, unknownHostPage } = Configuration;
  const misdirected = createMisdirectedHandler(unknownHostPage);
  const ports: Record<string, number | undefined> = { http: portHttp, https: portHttps };

  hosts
    .filter(({ instance }) => !(instance.protocol in ports))
    .forEach(({ instance }) => logger.error(`[${getDate()}] Unknown protocol ${instance.protocol} for ${instance.hostname}`));

  // one router per protocol instead of a vhost middleware per host, so that finding the host does not walk the list
  const forProtocol = (protocol: string, after: VirtualHost[] = []) =>
    virtualHostRouter(
      [
        ...hosts
          .filter(({ instance }) => instance.protocol === protocol)
          .map(({ instance, runtime, handler }) => {
            runtime.url = getURL(protocol, instance.hostname, ports[protocol]);
            return { hostname: instance.hostname, handler };
          }),
        ...after,
      ],
      hosts.find(({ instance }) => instance.protocol === protocol && instance.defaultHost)?.handler,
      misdirected
    );

  // after the http servers, so that one of the same name that was written out answers first
  const redirects = hosts
    .filter(({ instance }) => instance.protocol === 'https')
    .flatMap(({ instance: { hostname, redirectHttp } }) => (redirectHttp ? [{ hostname, handler: createHttpsRedirect(redirectHttp, portHttps) }] : []));

  return { http: forProtocol('http', redirects), https: forProtocol('https') };
}

export default setupVirtualHosts;
