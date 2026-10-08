import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PackageJson, WorkspacePackage } from '../types/version';

/** the packages in the folder that are not private */
export const readPackages = (packagesPath: string): WorkspacePackage[] =>
  readdirSync(packagesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(packagesPath, entry.name);
      const packageJsonPath = resolve(path, 'package.json');
      const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

      return { path, packageJsonPath, packageJson };
    })
    .filter(({ packageJson }) => !packageJson.private);
