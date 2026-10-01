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
const { execFileSync } = require('child_process');
const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { relative, resolve } = require('path');

const { GITHUB_RUN_ID, GITHUB_REF_NAME, NPM_REGISTRY_URL = 'https://registry.npmjs.org', VERSION_DRY_RUN, PUBLISH_ALL } = process.env;

if (!GITHUB_REF_NAME) {
  throw new Error(`GITHUB_REF_NAME: ${GITHUB_REF_NAME}`);
}

if (!GITHUB_RUN_ID) {
  throw new Error(`GITHUB_RUN_ID: ${GITHUB_RUN_ID}`);
}

const rootPath = resolve(__dirname, '..');
const packagesPath = resolve(rootPath, 'packages');
const now = new Date();
const newVersion = `${`${now.getFullYear()}`.substring(2)}.${`${now.getMonth() + 1}`.padStart(2, '0')}.${GITHUB_RUN_ID}-${GITHUB_REF_NAME.replace(/\//g, '-')}`;

const git = (...args) => execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const head = git('rev-parse', 'HEAD');

const isKnownCommit = (sha) => {
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const hasChangesSince = (sha, path) => git('diff', '--name-only', sha, head, '--', relative(rootPath, path)) !== '';

const readPackages = () =>
  readdirSync(packagesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(packagesPath, entry.name);
      const packageJsonPath = resolve(path, 'package.json');

      return { path, packageJsonPath, packageJson: JSON.parse(readFileSync(packageJsonPath, 'utf8')) };
    })
    .filter(({ packageJson }) => !packageJson.private);

/** the latest release on the registry, or undefined when the package was never published */
const fetchPublished = async (name) => {
  const response = await fetch(`${NPM_REGISTRY_URL}/${name.replace('/', '%2F')}/latest`);

  if (response.status === 404) return undefined;

  if (!response.ok) {
    throw new Error(`Failed to look up ${name} on ${NPM_REGISTRY_URL}: ${response.status} ${response.statusText}`);
  }

  const { version, gitHead } = await response.json();

  return { version, gitHead };
};

const getWorkspaceDependencies = (packages, { packageJson }) => {
  const names = packages.map((item) => item.packageJson.name);
  const declared = { ...packageJson.dependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies };

  return Object.keys(declared).filter((name) => names.includes(name));
};

/** the package itself and everything it depends on in the workspace, transitively */
const getFamily = (packages, item, family = new Set()) => {
  if (family.has(item.packageJson.name)) return family;

  family.add(item.packageJson.name);
  getWorkspaceDependencies(packages, item).forEach((name) => getFamily(
    packages,
    packages.find((candidate) => candidate.packageJson.name === name),
    family
  ));

  return family;
};

const getReason = (packages, item, published) => {
  if (PUBLISH_ALL) return 'PUBLISH_ALL is set';
  if (!published) return 'never published';
  if (!published.gitHead) return 'the published release has no gitHead';
  if (!isKnownCommit(published.gitHead)) return `the published commit ${published.gitHead.substring(0, 7)} is not in the history`;

  const changedMember = [...getFamily(packages, item)]
    .map((name) => packages.find((candidate) => candidate.packageJson.name === name))
    .find((member) => hasChangesSince(published.gitHead, member.path));

  if (!changedMember) return undefined;

  return changedMember === item
    ? `changed since ${published.gitHead.substring(0, 7)}`
    : `${changedMember.packageJson.name} changed since ${published.gitHead.substring(0, 7)}`;
};

const main = async () => {
  const packages = readPackages();
  const publishedList = await Promise.all(packages.map(({ packageJson }) => fetchPublished(packageJson.name)));

  const plan = packages.map((item, index) => ({ item, published: publishedList[index], reason: getReason(packages, item, publishedList[index]) }));

  plan.forEach(({ item, published, reason }) => {
    const { name } = item.packageJson;

    console.log(reason ? `${name}: ${newVersion} (${reason})` : `${name}: ${published.version} (unchanged, already published)`);
  });

  if (VERSION_DRY_RUN) return;

  plan.forEach(({ item, published, reason }) => {
    const packageJson = reason ? { ...item.packageJson, version: newVersion, gitHead: head } : { ...item.packageJson, version: published.version };

    writeFileSync(item.packageJsonPath, `${JSON.stringify(packageJson, undefined, 2)}\n`);
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
