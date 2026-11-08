import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
const PACKAGE_ROOT = resolve(__dirname, '../..');

/** the script the generated service definitions start */
export const SERVICE_SCRIPT_PATH = resolve(PACKAGE_ROOT, 'dist/scripts/cli.js');

export const SYSTEMD_FOLDER = '/etc/systemd/system';
export const LAUNCHD_FOLDER = '/Library/LaunchDaemons';
/** relative to the home folder */
export const SYSTEMD_USER_FOLDER = '.config/systemd/user';
export const LAUNCHD_AGENTS_FOLDER = 'Library/LaunchAgents';
export const LAUNCHD_LABEL_PREFIX = 'com.koeroesi86';

export const USAGE = `
Usage:

npx nws-cli --config <file> [--check]
npx nws-cli service <add|remove> --config <file> [--user]

--config falls back to the NODE_WEBSERVER_CONFIG environment variable.

  (none)          Starts the server in this process, what the service definitions run
  --check         Validates the configuration and the server files it names, starts nothing

  service add     Installs, enables and starts the service (needs root)
  service remove  Stops and removes the service (needs root)
  --user          With service add or remove: for the current user, no root (systemd --user, LaunchAgents)
`;
