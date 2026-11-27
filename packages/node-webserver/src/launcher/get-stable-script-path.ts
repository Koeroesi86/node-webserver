import fs from 'fs';
import path from 'path';

/** a file in the virtual store of pnpm, whose folders have the version in their name: the `node_modules` the store is in, and the path of the file in the package */
const STORE = /^(.*[\\/]node_modules)[\\/]\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/](.+)$/;

const isSameFile = (first: string, second: string) => {
  try {
    return fs.realpathSync(first) === fs.realpathSync(second);
  } catch {
    return false;
  }
};

/**
 * The path of a script that leads to its next version after an update. The shims pnpm writes for the commands of a project run the file in its store, a path that names the version
 * and goes on naming it: where the project has a link to the package, which an update moves, the path through that link is taken instead. Any other path is as it is.
 */
const getStableScriptPath = (script: string) => {
  const [, modules, file] = STORE.exec(script) ?? [];
  if (!modules) return script;

  const linked = path.join(modules, file);
  return isSameFile(linked, script) ? linked : script;
};

export default getStableScriptPath;
