const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const { GITHUB_RUN_ID, GITHUB_REF_NAME } = process.env;

if (!GITHUB_REF_NAME) {
  throw new Error(`GITHUB_REF_NAME: ${GITHUB_REF_NAME}`);
}

if (!GITHUB_RUN_ID) {
  throw new Error(`GITHUB_RUN_ID: ${GITHUB_RUN_ID}`);
}

const now = new Date();
const version = `${`${now.getFullYear()}`.substring(2)}.${`${now.getMonth() + 1}`.padStart(2, '0')}.${GITHUB_RUN_ID}-${GITHUB_REF_NAME.replace(/\//g, '-')}`;
const packagesPath = resolve(__dirname, '../packages');

readdirSync(packagesPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(packagesPath, entry.name, 'package.json'))
  .forEach((packageJsonPath) => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    if (packageJson.private) return;

    writeFileSync(packageJsonPath, `${JSON.stringify({ ...packageJson, version }, undefined, 2)}\n`);
    console.log('version set', packageJson.name, version);
  });
