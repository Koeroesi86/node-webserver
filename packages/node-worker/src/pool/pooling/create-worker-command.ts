import path from 'path';

/**
 * the command that runs a worker file, by the extension of the file: the executable and its arguments. A language is added with an entry here. JavaScript runs with the node of the
 * process, as the `PATH` of a service can have another one first, or none.
 */
export const workerCommands: Record<string, (workerPath: string) => string[]> = {
  '.js': (workerPath) => [process.execPath, '--expose-gc', path.resolve(__dirname, '../worker-invoke.js'), workerPath],
};

const defaultExtension = '.js';

/** The command of the worker file, the one of JavaScript when the extension has none. */
const createWorkerCommand = (workerPath: string): string[] => (workerCommands[path.extname(workerPath)] ?? workerCommands[defaultExtension])(workerPath);

export default createWorkerCommand;
