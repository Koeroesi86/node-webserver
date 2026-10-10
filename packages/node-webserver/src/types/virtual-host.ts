import type { RequestHandler } from 'express';

export interface VirtualHost {
  /** a host name, where `*` stands for one label of it, as in `*.example.com` */
  hostname: string;
  handler: RequestHandler;
}
