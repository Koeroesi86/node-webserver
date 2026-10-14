import setupChildListener from './setupChildListener';
import type { ServerState } from '../types';

const setupChildListeners = (hosts: ServerState[] = []) => {
  hosts.forEach(({ runtime: { child } }) => {
    if (child) {
      setupChildListener(child);
    }
  });
};

export default setupChildListeners;
