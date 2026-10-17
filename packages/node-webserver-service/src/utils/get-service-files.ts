import { homedir } from 'node:os';
import { posix } from 'path';
import { LAUNCHD_AGENTS_FOLDER, LAUNCHD_FOLDER, LAUNCHD_LABEL_PREFIX, SYSTEMD_FOLDER, SYSTEMD_USER_FOLDER } from '../constants';
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

/** the home folder and the user id, what a user service depends on */
export interface UserContext {
  home: string;
  uid: number | undefined;
}

const getServiceFiles = (
  platform: NodeJS.Platform,
  definition: ServiceDefinition,
  { home, uid }: UserContext = { home: homedir(), uid: process.getuid?.() }
): ServiceFiles => {
  const { name, userService } = definition;

  if (platform === 'linux') {
    const systemctl = userService ? ['systemctl', '--user'] : ['systemctl'];
    return {
      filePath: posix.join(userService ? posix.join(home, SYSTEMD_USER_FOLDER) : SYSTEMD_FOLDER, `${name}.service`),
      content: createSystemdUnit(definition),
      install: [
        [...systemctl, 'daemon-reload'],
        [...systemctl, 'enable', '--now', name],
      ],
      remove: [[...systemctl, 'disable', '--now', name]],
      afterRemove: [[...systemctl, 'daemon-reload']],
    };
  }

  if (platform === 'darwin') {
    const label = `${LAUNCHD_LABEL_PREFIX}.${name}`;
    const filePath = posix.join(userService ? posix.join(home, LAUNCHD_AGENTS_FOLDER) : LAUNCHD_FOLDER, `${label}.plist`);
    if (userService && uid === undefined) throw new Error('--user needs the user id of the current user, which this platform does not give.');
    const domain = userService ? `gui/${uid}` : 'system';
    return {
      filePath,
      content: createLaunchdPlist(label, definition),
      install: [['launchctl', 'bootstrap', domain, filePath]],
      remove: [['launchctl', 'bootout', `${domain}/${label}`]],
      afterRemove: [],
    };
  }

  throw new Error(
    `Services are generated for systemd (linux) and launchd (macOS), not for ${platform}. On Windows run "node <package>/dist/scripts/manageService.js --run --configuration <file>" from WinSW, NSSM or Task Scheduler, see the README.`
  );
};

export default getServiceFiles;
