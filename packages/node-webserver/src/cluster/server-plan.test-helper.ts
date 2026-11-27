import type { ServerPlan } from '../types';

/** the plan of a server with 2 fronts of the files `a` */
export const createPlan = (change: Partial<ServerPlan> = {}): ServerPlan => ({
  problems: [],
  frontCount: 2,
  balanced: true,
  singleFrontOnly: false,
  release: { configuration: 'a', version: '1.0.0' },
  files: ['configuration.js'],
  filesFingerprint: 'a',
  settings: { reloadOnSighup: false, shutdownTimeout: 100, watchServers: true },
  ...change,
});
