import type { RequestHandler } from 'express';
import getURL from './getURL';
import virtualHostRouter from './virtual-host-router';
import getDate from './getDate';
import type { Configuration, Logger, ServerState } from '../types';

interface StartedHost extends ServerState {
  handler: RequestHandler;
}

/** the handler of the http server and the one of the https server, which pass every request to the server of its host name */
function setupVirtualHosts(hosts: StartedHost[], Configuration: Partial<Configuration>, logger: Logger): Record<'http' | 'https', RequestHandler> {
  const { portHttp, portHttps } = Configuration;
  const ports: Record<string, number | undefined> = { http: portHttp, https: portHttps };

  hosts
    .filter(({ instance }) => !(instance.protocol in ports))
    .forEach(({ instance }) => logger.error(`[${getDate()}] Unknown protocol ${instance.protocol} for ${instance.hostname}`));

  // one router per protocol instead of a vhost middleware per host, so that finding the host does not walk the list
  const forProtocol = (protocol: string) =>
    virtualHostRouter(
      hosts
        .filter(({ instance }) => instance.protocol === protocol)
        .map(({ instance, runtime, handler }) => {
          runtime.url = getURL(protocol, instance.hostname, ports[protocol]);
          return { hostname: instance.hostname, handler };
        })
    );

  return { http: forProtocol('http'), https: forProtocol('https') };
}

export default setupVirtualHosts;
