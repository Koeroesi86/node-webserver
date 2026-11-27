import path from 'path';

/** the packages are left out, a change of the configuration does not touch them */
const isLocal = (file: string) => !file.split(path.sep).includes('node_modules');

/** the file of a module and the files it loaded, without the ones of packages */
const getModuleFiles = (module: NodeJS.Module, files = new Set<string>()): Set<string> => {
  if (files.has(module.filename) || !isLocal(module.filename)) return files;

  files.add(module.filename);
  module.children.forEach((child) => getModuleFiles(child, files));

  return files;
};

export default getModuleFiles;
