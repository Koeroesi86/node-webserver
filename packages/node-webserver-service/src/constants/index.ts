import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
const PACKAGE_ROOT = resolve(__dirname, '../..');

export const DEFAULT_CONFIGURATION_PATH = resolve(PACKAGE_ROOT, 'configuration.example.js');

/** the script the generated service definitions start, with --run */
export const SERVICE_SCRIPT_PATH = resolve(PACKAGE_ROOT, 'dist/scripts/manage-service.js');

export const SYSTEMD_FOLDER = '/etc/systemd/system';
export const LAUNCHD_FOLDER = '/Library/LaunchDaemons';
/** relative to the home folder */
export const SYSTEMD_USER_FOLDER = '.config/systemd/user';
export const LAUNCHD_AGENTS_FOLDER = 'Library/LaunchAgents';
export const LAUNCHD_LABEL_PREFIX = 'com.koeroesi86';

export const USAGE = `
Usage:

npx nws-service [argument] --configuration <file>

arguments:
    --add      Installs and starts the service (needs root)
    --remove   Stops and removes the service (needs root)
    --user     With --add or --remove: for the current user, no root (systemd --user, LaunchAgents)
    --run      Runs the server in this process, what the service definitions start

--configuration falls back to the NODE_WEBSERVER_CONFIG environment variable.
`;
