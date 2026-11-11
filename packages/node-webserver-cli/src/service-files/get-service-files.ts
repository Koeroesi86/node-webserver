import { homedir, userInfo } from 'node:os';
import getLaunchdServiceFiles from './get-launchd-service-files';
import getSystemdServiceFiles from './get-systemd-service-files';
import getWindowsServiceFiles from './get-windows-service-files';
import type { ServiceDefinition, ServiceFiles } from '../types';

/** the home folder, the user id and the name of the user, what a user service depends on */
export interface UserContext {
  home: string;
  uid: number | undefined;
  userName?: string;
}

const getServiceFiles = (
  platform: NodeJS.Platform,
  definition: ServiceDefinition,
  { home, uid, userName = userInfo().username }: UserContext = { home: homedir(), uid: process.getuid?.() }
): ServiceFiles => {
  if (platform === 'linux') return getSystemdServiceFiles(definition, home);
  if (platform === 'darwin') return getLaunchdServiceFiles(definition, home, uid);
  if (platform === 'win32') return getWindowsServiceFiles(definition, home, userName);

  throw new Error(`Services are generated for systemd (linux), launchd (macOS) and Task Scheduler (Windows), not for ${platform}.`);
};

export default getServiceFiles;
