import type { WorkspacePackage } from '../types/version';
import { getWorkspaceDependencies } from './get-workspace-dependencies';

/** the package itself and everything it depends on in the workspace, transitively */
export const getPackageFamily = (packages: WorkspacePackage[], item: WorkspacePackage, family = new Set<WorkspacePackage>()): Set<WorkspacePackage> => {
  if (family.has(item)) return family;

  family.add(item);
  getWorkspaceDependencies(packages, item).forEach((dependency) => getPackageFamily(packages, dependency, family));

  return family;
};
