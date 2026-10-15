import path from 'path';

/** the command line that runs a worker file, by the extension of the file: a language is added with an entry here */
export const workerCommands: Record<string, (workerPath: string) => string> = {
  '.js': (workerPath) => `node --expose-gc ${path.resolve(__dirname, '../workerInvoke.js')} ${workerPath}`,
};

const defaultExtension = '.js';

/** The command of the worker file, the one of JavaScript when the extension has none. */
const createWorkerCommand = (workerPath: string): string => (workerCommands[path.extname(workerPath)] ?? workerCommands[defaultExtension])(workerPath);

export default createWorkerCommand;
