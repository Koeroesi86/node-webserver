import type { PackageJson, WorkspacePackage } from '../types/version';

/** a package of the workspace, the folder and the file are where it would be */
export const workspacePackage = (name: string, more: Partial<PackageJson> = {}): WorkspacePackage => ({
  path: `/workspace/packages/${name}`,
  packageJsonPath: `/workspace/packages/${name}/package.json`,
  packageJson: { name, ...more },
});
