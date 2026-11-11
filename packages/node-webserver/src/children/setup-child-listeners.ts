import setupChildListener from './setup-child-listener';
import type { Logger, ServerState } from '../types';

const setupChildListeners = (logger: Logger, hosts: ServerState[] = []) => {
  hosts.forEach(({ runtime: { child } }) => {
    if (child) {
      setupChildListener(child, logger);
    }
  });
};

export default setupChildListeners;
