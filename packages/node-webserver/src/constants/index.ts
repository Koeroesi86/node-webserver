import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
};

export const PROXY_PROTOCOLS: Record<string, string> = {
  http: 'http',
  https: 'http',
  ws: 'ws',
  wss: 'ws',
};
