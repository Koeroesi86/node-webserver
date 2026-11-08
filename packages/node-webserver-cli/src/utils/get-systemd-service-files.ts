import { posix } from 'path';
import { SYSTEMD_FOLDER, SYSTEMD_USER_FOLDER } from '../constants';
import createSystemdUnit from './create-systemd-unit';
import type { ServiceDefinition, ServiceFiles } from '../types';

const getSystemdServiceFiles = (definition: ServiceDefinition, home: string): ServiceFiles => {
  const { name, userService } = definition;
  const systemctl = userService ? ['systemctl', '--user'] : ['systemctl'];
  const folder = userService ? posix.join(home, SYSTEMD_USER_FOLDER) : undefined;

  return {
    filePath: posix.join(folder ?? SYSTEMD_FOLDER, `${name}.service`),
    folder,
    content: createSystemdUnit(definition),
    install: [
      [...systemctl, 'daemon-reload'],
      [...systemctl, 'enable', '--now', name],
    ],
    stop: [],
    remove: [[...systemctl, 'disable', '--now', name]],
    afterRemove: [[...systemctl, 'daemon-reload']],
  };
};

export default getSystemdServiceFiles;
