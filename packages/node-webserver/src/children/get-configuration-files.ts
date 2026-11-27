import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import getModuleFiles from './get-module-files';

/**
 * The files a configuration was loaded from: the given one, as it can be reached through a link, and the ones it loaded, for a file that was loaded with `require` in this process.
 * Only the given one otherwise.
 */
const getConfigurationFiles = (configurationFile: string): string[] => {
  const given = path.resolve(configurationFile);

  if (!fs.existsSync(given)) return [given];

  const module = createRequire(given).cache[fs.realpathSync(given)];

  return Array.from(new Set([given, ...(module ? getModuleFiles(module) : [])]));
};

export default getConfigurationFiles;
