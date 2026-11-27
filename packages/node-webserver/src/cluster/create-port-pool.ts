import { findPorts } from '../utils';
import type { PortLookup } from '../types';

/**
 * The ports the primary starts applications on: the free ones of a lookup (3000 to 3010 without one), each for one application until it is given back. A lookup is made once,
 * as it needs as many free ports as it spans, which it does not find once applications listen on them.
 */
const createPortPool = (find: typeof findPorts = findPorts) => {
  const found = new Map<string, Promise<number[]>>();
  const taken = new Set<number>();

  const search = (id: string, lookup?: PortLookup) => {
    const ports = found.get(id) ?? find(lookup).then((free) => free.slice());
    found.set(id, ports);
    // one that failed is made again for the next application
    ports.catch(() => found.delete(id));

    return ports;
  };

  return {
    take: async (lookup?: PortLookup) => {
      const port = (await search(JSON.stringify(lookup) ?? '', lookup)).find((free) => !taken.has(free));
      if (port === undefined) throw new Error('No more available port left.');
      taken.add(port);

      return port;
    },
    give: (port: number) => void taken.delete(port),
  };
};

export default createPortPool;
