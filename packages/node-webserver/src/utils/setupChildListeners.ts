import setupChildListener from './setupChildListener';
import type { ServerInstance } from '../types';

const setupChildListeners = (instances: ServerInstance[] = []) => {
  instances.forEach(({ child }) => {
    if (child) {
      setupChildListener(child);
    }
  });
};

export default setupChildListeners;
