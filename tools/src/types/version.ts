export interface PackageJson {
  name: string;
  version?: string;
  gitHead?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface WorkspacePackage {
  path: string;
  packageJsonPath: string;
  packageJson: PackageJson;
}

export interface PublishedRelease {
  version: string;
  gitHead?: string;
}

export interface PlanItem {
  item: WorkspacePackage;
  published?: PublishedRelease;
  /** why the package gets a new version, undefined when the published one is used */
  reason?: string;
}

/** what the version script needs to know about the commits of the workspace */
export interface Git {
  head: string;
  isKnownCommit: (sha: string) => boolean;
  hasChangesSince: (sha: string, path: string) => boolean;
}
