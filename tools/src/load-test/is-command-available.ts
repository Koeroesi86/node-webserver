import { spawnSync } from 'node:child_process';

/** whether the command can be started and exits successfully with the arguments (`k6 version`, `docker --version`) */
export const isCommandAvailable = (command: string, args: string[]) => spawnSync(command, args, { stdio: 'ignore', env: { ...process.env } }).status === 0;
