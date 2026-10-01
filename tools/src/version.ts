/**
 * Prepares the versions of the workspace packages for publishing.
 *
 * A package is published when it has no published release yet, or when its own folder or the folder of any workspace
 * package it depends on changed since the commit that its latest published release was created from (`gitHead`).
 * Such packages get a new version and their commit written to `gitHead`. All the others get the version that is
 * already on the registry, so the `workspace:` dependencies pointing at them are rewritten to an existing release
 * and `pnpm publish` leaves them out, as that version is published already.
 *
 * Environment:
 *  - GITHUB_RUN_ID, GITHUB_REF_NAME: required, used for the new version
 *  - NPM_REGISTRY_URL: the registry to compare with, defaults to https://registry.npmjs.org
 *  - VERSION_DRY_RUN: set to only print the plan without changing any file
 *  - PUBLISH_ALL: set to publish every package regardless of the changes
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

interface PackageJson {
  name: string;
  version?: string;
  gitHead?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface WorkspacePackage {
  path: string;
  packageJsonPath: string;
  packageJson: PackageJson;
}

interface PublishedRelease {
  version: string;
  gitHead?: string;
}

interface PlanItem {
  item: WorkspacePackage;
  published?: PublishedRelease;
  reason?: string;
}

const { GITHUB_RUN_ID, GITHUB_REF_NAME, NPM_REGISTRY_URL = 'https://registry.npmjs.org', VERSION_DRY_RUN, PUBLISH_ALL } = process.env;

if (!GITHUB_REF_NAME) {
  throw new Error(`GITHUB_REF_NAME: ${GITHUB_REF_NAME}`);
}

if (!GITHUB_RUN_ID) {
  throw new Error(`GITHUB_RUN_ID: ${GITHUB_RUN_ID}`);
}

// compiled to tools/dist, the workspace root is two levels up
const rootPath = resolve(__dirname, '../..');
const packagesPath = resolve(rootPath, 'packages');
const now = new Date();
const newVersion = `${`${now.getFullYear()}`.substring(2)}.${`${now.getMonth() + 1}`.padStart(2, '0')}.${GITHUB_RUN_ID}-${GITHUB_REF_NAME.replace(/\//g, '-')}`;

const git = (...args: string[]): string => execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const head = git('rev-parse', 'HEAD');

const isKnownCommit = (sha: string): boolean => {
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const hasChangesSince = (sha: string, path: string): boolean => git('diff', '--name-only', sha, head, '--', relative(rootPath, path)) !== '';

const readPackages = (): WorkspacePackage[] =>
  readdirSync(packagesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(packagesPath, entry.name);
      const packageJsonPath = resolve(path, 'package.json');
      const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

      return { path, packageJsonPath, packageJson };
    })
    .filter(({ packageJson }) => !packageJson.private);

/** the latest release on the registry, or undefined when the package was never published */
const fetchPublished = async (name: string): Promise<PublishedRelease | undefined> => {
  const response = await fetch(`${NPM_REGISTRY_URL}/${name.replace('/', '%2F')}/latest`);

  if (response.status === 404) return undefined;

  if (!response.ok) {
    throw new Error(`Failed to look up ${name} on ${NPM_REGISTRY_URL}: ${response.status} ${response.statusText}`);
  }

  const { version, gitHead }: PublishedRelease = JSON.parse(await response.text());

  return { version, gitHead };
};

const getWorkspaceDependencies = (packages: WorkspacePackage[], { packageJson }: WorkspacePackage): WorkspacePackage[] =>
  Object.keys({ ...packageJson.dependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies })
    .map((name) => packages.find((candidate) => candidate.packageJson.name === name))
    .filter((dependency) => dependency !== undefined);

/** the package itself and everything it depends on in the workspace, transitively */
const getFamily = (packages: WorkspacePackage[], item: WorkspacePackage, family = new Set<WorkspacePackage>()): Set<WorkspacePackage> => {
  if (family.has(item)) return family;

  family.add(item);
  getWorkspaceDependencies(packages, item).forEach((dependency) => getFamily(packages, dependency, family));

  return family;
};

const getReason = (packages: WorkspacePackage[], item: WorkspacePackage, published?: PublishedRelease): string | undefined => {
  if (PUBLISH_ALL) return 'PUBLISH_ALL is set';
  if (!published) return 'never published';
  if (!published.gitHead) return 'the published release has no gitHead';

  const { gitHead } = published;
  const short = gitHead.substring(0, 7);

  if (!isKnownCommit(gitHead)) return `the published commit ${short} is not in the history`;

  const changedMember = [...getFamily(packages, item)].find((member) => hasChangesSince(gitHead, member.path));

  if (!changedMember) return undefined;

  return changedMember === item ? `changed since ${short}` : `${changedMember.packageJson.name} changed since ${short}`;
};

const describe = ({ item, published, reason }: PlanItem): string =>
  `${item.packageJson.name}: ${reason ? newVersion : published?.version} (${reason ?? 'unchanged, already published'})`;

const stamp = ({ item, published, reason }: PlanItem): PackageJson =>
  reason ? { ...item.packageJson, version: newVersion, gitHead: head } : { ...item.packageJson, version: published?.version };

const main = async (): Promise<void> => {
  const packages = readPackages();
  const publishedList = await Promise.all(packages.map(({ packageJson }) => fetchPublished(packageJson.name)));
  const plan: PlanItem[] = packages.map((item, index) => ({ item, published: publishedList[index], reason: getReason(packages, item, publishedList[index]) }));

  plan.map(describe).forEach((line) => console.log(line));

  if (VERSION_DRY_RUN) return;

  plan.forEach((planItem) => writeFileSync(planItem.item.packageJsonPath, `${JSON.stringify(stamp(planItem), undefined, 2)}\n`));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
