import { posix } from 'path';
import { LAUNCHD_AGENTS_FOLDER, LAUNCHD_FOLDER, LAUNCHD_LABEL_PREFIX } from '../constants';
import createLaunchdPlist from './create-launchd-plist';
import type { ServiceDefinition, ServiceFiles } from '../types';

const getLaunchdServiceFiles = (definition: ServiceDefinition, home: string, uid: number | undefined): ServiceFiles => {
  const { name, userService } = definition;

  if (userService && uid === undefined) throw new Error('--user needs the user id of the current user, which this platform does not give.');

  const label = `${LAUNCHD_LABEL_PREFIX}.${name}`;
  const folder = userService ? posix.join(home, LAUNCHD_AGENTS_FOLDER) : undefined;
  const filePath = posix.join(folder ?? LAUNCHD_FOLDER, `${label}.plist`);
  const domain = userService ? `gui/${uid}` : 'system';

  return {
    filePath,
    folder,
    content: createLaunchdPlist(label, definition),
    install: [['launchctl', 'bootstrap', domain, filePath]],
    stop: [],
    remove: [['launchctl', 'bootout', `${domain}/${label}`]],
    afterRemove: [],
  };
};

export default getLaunchdServiceFiles;
