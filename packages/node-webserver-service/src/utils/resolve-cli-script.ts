import { dirname, resolve } from 'node:path';

/** the script behind the nws-cli bin of the installed package, found through its manifest, which the package exports */
const resolveCliScript = (): string => {
  const manifestPath = require.resolve('@koeroesi86/node-webserver-cli/package.json');
  const { bin }: { bin: Record<string, string> } = require(manifestPath);

  return resolve(dirname(manifestPath), bin['nws-cli']);
};

export default resolveCliScript;
