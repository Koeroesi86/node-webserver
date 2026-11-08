import { resolve, win32 } from 'path';

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
/** where the task definition of Task Scheduler is kept, for all users and (relative to the home folder) for the current user */
export const WINDOWS_TASK_FOLDER = win32.join(process.env.ProgramData || 'C:\\ProgramData', 'nws-cli');
export const WINDOWS_USER_TASK_FOLDER = 'AppData\\Local\\nws-cli';

export const USAGE = `
Usage:

npx nws-cli --config <file> [--check]
npx nws-cli service <add|remove> --config <file> [--user]

--config falls back to the NODE_WEBSERVER_CONFIG environment variable.

  (none)          Starts the server in this process, what the service definitions run
  --check         Validates the configuration and the server files it names, starts nothing

  service add     Installs, enables and starts the service (needs root, an administrator on Windows)
  service remove  Stops and removes the service (needs root, an administrator on Windows)
  --user          With service add or remove: for the current user, no root (systemd --user, LaunchAgents, a task at logon on Windows)
`;
