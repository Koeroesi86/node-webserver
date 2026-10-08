import type { WorkspacePackage } from '../types/version';

export const getWorkspaceDependencies = (packages: WorkspacePackage[], { packageJson }: WorkspacePackage): WorkspacePackage[] =>
  Object.keys({ ...packageJson.dependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies })
    .map((name) => packages.find((candidate) => candidate.packageJson.name === name))
    .filter((dependency) => dependency !== undefined);
