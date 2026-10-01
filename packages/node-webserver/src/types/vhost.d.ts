declare module 'vhost' {
  import type { RequestHandler } from 'express';

  /** vhost is always mounted on an express app here, so the handlers are express handlers */
  function vhost(hostname: string | RegExp, handler: RequestHandler): RequestHandler;

  export = vhost;
}
