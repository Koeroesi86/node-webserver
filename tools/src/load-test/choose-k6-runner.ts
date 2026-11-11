import type { K6Runner } from '../types/k6';
import { isCommandAvailable } from './is-command-available';

/** the installed k6 when there is one, otherwise Docker, undefined when there is neither */
export const chooseK6Runner = (): K6Runner | undefined => {
  if (isCommandAvailable('k6', ['version'])) return 'native';

  return isCommandAvailable('docker', ['--version']) ? 'docker' : undefined;
};
