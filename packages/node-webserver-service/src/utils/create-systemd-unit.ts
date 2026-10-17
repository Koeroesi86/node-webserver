import type { ServiceDefinition } from '../types';

/** systemd expands % and $ inside the quotes too */
const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

const createSystemdUnit = ({ displayName, nodePath, scriptPath, configPath, workingDirectory, user, userService }: ServiceDefinition): string =>
  [
    '[Unit]',
    `Description=${displayName.replace(/\s+/g, ' ')}`,
    ...(userService ? [] : ['After=network.target']),
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${[nodePath, scriptPath, '--run', '--configuration', configPath].map(quote).join(' ')}`,
    `WorkingDirectory=${workingDirectory.replace(/\s/g, '\\x20')}`,
    'Restart=on-failure',
    ...(user ? [`User=${user}`] : []),
    '',
    '[Install]',
    `WantedBy=${userService ? 'default' : 'multi-user'}.target`,
    '',
  ].join('\n');

export default createSystemdUnit;
