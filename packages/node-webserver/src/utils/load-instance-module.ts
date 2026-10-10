import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type { ServerInstance } from '../types';

/** the files each server module was loaded from the last time, also of a module whose file was removed since, as its file can come back */
const loadedFiles = new Map<string, string[]>();

/** the packages are left out, a change of the configuration does not touch them */
const isLocal = (file: string) => !file.split(path.sep).includes('node_modules');

const collectFiles = (module: NodeJS.Module, files = new Set<string>()): Set<string> => {
  if (files.has(module.filename) || !isLocal(module.filename)) return files;

  files.add(module.filename);
  module.children.forEach((child) => collectFiles(child, files));

  return files;
};

const isServerInstance = (value: unknown): value is ServerInstance =>
  typeof value === 'object' &&
  value !== null &&
  'hostname' in value &&
  typeof value.hostname === 'string' &&
  'protocol' in value &&
  typeof value.protocol === 'string';

/**
 * Loads the server definition a module exports, with the files it was loaded from: the module and the ones it loaded.
 * The files of the last time are loaded anew instead of being taken from the cache of node. Undefined when there is no such file.
 */
const loadInstanceModule = (configPath: string): { instance: ServerInstance; files: string[] } | undefined => {
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    return undefined;
  }

  // the require of node, also in the tests, which have a module registry of their own
  const load = createRequire(resolvedPath);
  // node keeps a module by its real path, which differs from the given one when the path goes through a link (the temporary folder of macOS is one)
  const filename = load.resolve(resolvedPath);
  [filename, ...(loadedFiles.get(filename) ?? [])].forEach((file) => delete load.cache[file]);
  const instance: unknown = load(filename);
  const module = load.cache[filename];
  const files = module ? Array.from(collectFiles(module)) : [filename];
  loadedFiles.set(filename, files);

  if (!isServerInstance(instance)) {
    throw new Error(`${filename} does not export a server with a hostname and a protocol.`);
  }

  return { instance, files };
};

export default loadInstanceModule;
