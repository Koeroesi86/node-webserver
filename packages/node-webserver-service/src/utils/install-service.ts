import { writeFile } from 'node:fs/promises';
import getServiceFiles from './get-service-files';
import runCommand from './run-command';
import type { ServiceDefinition } from '../types';

export interface InstallDependencies {
  platform: NodeJS.Platform;
  writeFile: (path: string, content: string) => Promise<void>;
  runCommand: (command: string, args: string[]) => Promise<void>;
}

export const defaultDependencies: InstallDependencies = { platform: process.platform, writeFile, runCommand };

const installService = async (definition: ServiceDefinition, dependencies: Partial<InstallDependencies> = {}): Promise<void> => {
  const deps = { ...defaultDependencies, ...dependencies };
  const { filePath, content, install } = getServiceFiles(deps.platform, definition);

  try {
    await deps.writeFile(filePath, content);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`Installing the service writes ${filePath}, run this as root (sudo) or administrator.`);
    }
    throw error;
  }

  for (const [command, ...args] of install) {
    await deps.runCommand(command, args);
  }
};

export default installService;
