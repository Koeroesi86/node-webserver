import { rm } from 'node:fs/promises';
import explainPermissionError from './explain-permission-error';
import getServiceFiles from './get-service-files';
import { defaultDependencies } from './install-service';
import type { InstallDependencies } from './install-service';
import type { UserContext } from './get-service-files';
import type { ServiceDefinition } from '../types';

interface RemoveDependencies extends Pick<InstallDependencies, 'platform' | 'runCommand'> {
  removeFile: (path: string) => Promise<void>;
}

const removeService = async (definition: ServiceDefinition, dependencies: Partial<RemoveDependencies> = {}, user?: UserContext): Promise<void> => {
  const deps = { platform: defaultDependencies.platform, runCommand: defaultDependencies.runCommand, removeFile: (path: string) => rm(path), ...dependencies };
  const { filePath, remove, afterRemove } = getServiceFiles(deps.platform, definition, user);

  for (const [command, ...args] of remove) {
    await deps.runCommand(command, args);
  }

  try {
    await deps.removeFile(filePath);
  } catch (error) {
    throw explainPermissionError(error, `Removing the service deletes ${filePath}, run this as root (sudo) or administrator.`);
  }

  for (const [command, ...args] of afterRemove) {
    await deps.runCommand(command, args);
  }
};

export default removeService;
