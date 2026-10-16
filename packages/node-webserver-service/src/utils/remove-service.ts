import { rm } from 'node:fs/promises';
import getServiceFiles from './get-service-files';
import { defaultDependencies } from './install-service';
import type { InstallDependencies } from './install-service';
import type { ServiceDefinition } from '../types';

interface RemoveDependencies extends Pick<InstallDependencies, 'platform' | 'runCommand'> {
  removeFile: (path: string) => Promise<void>;
}

const removeService = async (definition: ServiceDefinition, dependencies: Partial<RemoveDependencies> = {}): Promise<void> => {
  const deps = { platform: defaultDependencies.platform, runCommand: defaultDependencies.runCommand, removeFile: (path: string) => rm(path), ...dependencies };
  const { filePath, remove, afterRemove } = getServiceFiles(deps.platform, definition);

  for (const [command, ...args] of remove) {
    await deps.runCommand(command, args);
  }

  try {
    await deps.removeFile(filePath);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`Removing the service deletes ${filePath}, run this as root (sudo) or administrator.`);
    }
    throw error;
  }

  for (const [command, ...args] of afterRemove) {
    await deps.runCommand(command, args);
  }
};

export default removeService;
