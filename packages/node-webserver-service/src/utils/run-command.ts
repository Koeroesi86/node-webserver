import { execFile } from 'node:child_process';

/** no shell, a non-zero exit rejects */
const runCommand = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (error) return reject(new Error(`${[command, ...args].join(' ')} failed: ${stderr.trim() || error.message}`));
      resolve();
    });
  });

export default runCommand;
