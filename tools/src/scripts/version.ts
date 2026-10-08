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
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVersion } from '../utils/create-version';
import { describePlanItem } from '../utils/describe-plan-item';
import { planVersions } from '../utils/plan-versions';
import { stampPackage } from '../utils/stamp-package';

const { GITHUB_RUN_ID, GITHUB_REF_NAME, NPM_REGISTRY_URL = 'https://registry.npmjs.org', VERSION_DRY_RUN, PUBLISH_ALL } = process.env;

if (!GITHUB_REF_NAME) {
  throw new Error(`GITHUB_REF_NAME: ${GITHUB_REF_NAME}`);
}

if (!GITHUB_RUN_ID) {
  throw new Error(`GITHUB_RUN_ID: ${GITHUB_RUN_ID}`);
}

// compiled to tools/dist/scripts, the workspace root is three levels up
const rootPath = resolve(__dirname, '../../..');
const newVersion = createVersion(new Date(), GITHUB_RUN_ID, GITHUB_REF_NAME);

planVersions(rootPath, NPM_REGISTRY_URL, Boolean(PUBLISH_ALL))
  .then(({ plan, head }) => {
    plan.forEach((planItem) => console.log(describePlanItem(planItem, newVersion)));

    if (VERSION_DRY_RUN) return;

    plan.forEach((planItem) => writeFileSync(planItem.item.packageJsonPath, `${JSON.stringify(stampPackage(planItem, newVersion, head), undefined, 2)}\n`));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
