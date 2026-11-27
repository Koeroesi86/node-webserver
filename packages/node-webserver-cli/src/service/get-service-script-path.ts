import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStableScriptPath } from '@koeroesi86/node-webserver';
import { SERVICE_SCRIPT_PATH } from '../constants';

const leadsTo = (path: string, script: string) => {
  try {
    return realpathSync(path) === realpathSync(script);
  } catch {
    return false;
  }
};

/**
 * The script a service definition starts: the path the command was run by, with its links, where it leads to this installation. An update that points a link to a new release is then
 * what the service starts next, where the path without the links would go on naming the old one.
 * A path in the store of pnpm is taken through the link to the package.
 */
const getServiceScriptPath = (invoked: string | undefined = process.argv[1], script: string = SERVICE_SCRIPT_PATH): string =>
  getStableScriptPath(invoked && leadsTo(invoked, script) ? resolve(invoked) : script);

export default getServiceScriptPath;
