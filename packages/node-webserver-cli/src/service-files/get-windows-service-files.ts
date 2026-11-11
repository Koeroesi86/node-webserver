import { win32 } from 'path';
import { WINDOWS_TASK_FOLDER, WINDOWS_USER_TASK_FOLDER } from '../constants';
import createTaskXml from './create-task-xml';
import type { ServiceDefinition, ServiceFiles } from '../types';

/** Task Scheduler runs the task as SYSTEM at boot, or as the current user at logon, and restarts it when it fails */
const getWindowsServiceFiles = (definition: ServiceDefinition, home: string, userName: string): ServiceFiles => {
  const { name, userService, user } = definition;

  if (user) throw new Error('serviceUser is not supported on Windows, a task runs as SYSTEM or, with --user, as the current user.');

  const folder = userService ? win32.join(home, WINDOWS_USER_TASK_FOLDER) : WINDOWS_TASK_FOLDER;
  const filePath = win32.join(folder, `${name}.xml`);

  return {
    filePath,
    folder,
    content: createTaskXml(definition, userName),
    install: [
      ['schtasks', '/create', '/tn', name, '/xml', filePath, '/f'],
      ['schtasks', '/run', '/tn', name],
    ],
    // /end fails when the task is not running, which is nothing to stop
    stop: [['schtasks', '/end', '/tn', name]],
    remove: [['schtasks', '/delete', '/tn', name, '/f']],
    afterRemove: [],
  };
};

export default getWindowsServiceFiles;
