import type { K6CommandOptions } from '../types/k6';

const containerScripts = '/scripts';

/**
 * The command that runs a scenario. The image shares the network of the host, so `localhost` is the server there as well, and the scenarios are
 * mounted read only. SELinux labels are switched off for the container, as a mount would otherwise be refused on Fedora (without relabelling the repository).
 */
export const buildK6Command = ({ runner, scriptsDirectory, script, args, image }: K6CommandOptions) =>
  runner === 'native'
    ? ['k6', 'run', ...args, `${scriptsDirectory}/${script}`]
    : [
        'docker',
        'run',
        '--rm',
        '-i',
        '--network',
        'host',
        '--security-opt',
        'label=disable',
        '-v',
        `${scriptsDirectory}:${containerScripts}:ro`,
        image,
        'run',
        ...args,
        `${containerScripts}/${script}`,
      ];
