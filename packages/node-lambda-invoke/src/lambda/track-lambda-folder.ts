import { rmSync } from 'node:fs';

/** the folders of the lambda processes that run */
const folders = new Set<string>();

const removeFolders = () => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true }));

/**
 * Removes the folder when the process exits, which stops the lambdas as well, until the returned function is called. Only a kill leaves them, the next server sweeps them.
 * The exit listener is on the process only while a folder is tracked, so importing the module hooks nothing.
 */
const trackLambdaFolder = (root: string): (() => void) => {
  if (folders.size === 0) process.once('exit', removeFolders);
  folders.add(root);

  return () => {
    folders.delete(root);
    if (folders.size === 0) process.off('exit', removeFolders);
  };
};

export default trackLambdaFolder;
