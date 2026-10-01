declare module '@koeroesi86/node-lambda-invoke' {
  import type { RequestHandler } from 'express';

  export interface HttpMiddlewareOptions {
    lambdaPath: string;
    handlerKey?: string;
    logger?: (...args: unknown[]) => void;
    limit?: number;
    communication?: { type?: string; path?: string };
  }

  export function httpMiddleware(options: HttpMiddlewareOptions): RequestHandler;
}
