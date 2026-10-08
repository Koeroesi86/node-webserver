import type { PackageJson, PlanItem } from '../types/version';

/** the package.json with the new version and its commit, or with the published version when nothing changed */
export const stampPackage = ({ item, published, reason }: PlanItem, newVersion: string, head: string): PackageJson =>
  reason ? { ...item.packageJson, version: newVersion, gitHead: head } : { ...item.packageJson, version: published?.version };
