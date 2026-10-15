import { posix } from 'path';
import { LAUNCHD_FOLDER, LAUNCHD_LABEL_PREFIX, SYSTEMD_FOLDER } from '../constants';
import createLaunchdPlist from './create-launchd-plist';
import createSystemdUnit from './create-systemd-unit';
import type { ServiceDefinition } from '../types';

interface ServiceFiles {
  /** where the definition goes */
  filePath: string;
  /** what goes into it */
  content: string;
  /** the commands that load it, and unload it */
  install: string[][];
  remove: string[][];
  /** to run after the file is gone */
  afterRemove: string[][];
}

const getServiceFiles = (platform: NodeJS.Platform, definition: ServiceDefinition): ServiceFiles => {
  const { name } = definition;

  if (platform === 'linux') {
    return {
      filePath: posix.join(SYSTEMD_FOLDER, `${name}.service`),
      content: createSystemdUnit(definition),
      install: [
        ['systemctl', 'daemon-reload'],
        ['systemctl', 'enable', '--now', name],
      ],
      remove: [['systemctl', 'disable', '--now', name]],
      afterRemove: [['systemctl', 'daemon-reload']],
    };
  }

  if (platform === 'darwin') {
    const label = `${LAUNCHD_LABEL_PREFIX}.${name}`;
    const filePath = posix.join(LAUNCHD_FOLDER, `${label}.plist`);
    return {
      filePath,
      content: createLaunchdPlist(label, definition),
      install: [['launchctl', 'bootstrap', 'system', filePath]],
      remove: [['launchctl', 'bootout', `system/${label}`]],
      afterRemove: [],
    };
  }

  throw new Error(
    `Services are generated for systemd (linux) and launchd (macOS), not for ${platform}. On Windows run "node <package>/dist/scripts/manageService.js --run --configuration <file>" from WinSW, NSSM or Task Scheduler, see the README.`
  );
};

export default getServiceFiles;
