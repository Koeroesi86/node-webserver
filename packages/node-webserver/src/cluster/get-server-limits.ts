import type { ServerConfig } from '../types';

/** a path with a limit of 0 keeps a single worker, so it is a limit of 1 */
const getPathLimit = (limitPerPath: unknown) => (typeof limitPerPath === 'number' ? Math.max(limitPerPath, 1) : undefined);

/** the limits on the processes of a server that are set to a number, which the fronts have to share. Anything else, which the check reports, is left to the check. */
const getServerLimits = (instance: ServerConfig | undefined): unknown[] => {
  if (instance?.type === 'worker') return [instance.options?.limit, getPathLimit(instance.options?.limitPerPath)];
  if (instance?.type !== 'lambda') return [];

  const { limit, routes } = instance.lambdaOptions ?? {};

  return [limit, ...(Array.isArray(routes) ? routes.map((route) => route?.limit) : [])];
};

export default getServerLimits;
