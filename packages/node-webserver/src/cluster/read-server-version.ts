import fs from 'fs';
import path from 'path';
import { PACKAGE_ROOT } from '../constants';
import findInstalledPackage from './find-installed-package';

const SERVER = '@koeroesi86/node-webserver';
const PREFIX = '@koeroesi86/';

const read = (folder: string): { name?: string; version?: string; dependencies?: Record<string, string> } =>
  JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));

/** the nearest folder above with a package, the one the file belongs to */
const findPackageOf = (folder: string): string | undefined => {
  if (fs.existsSync(path.join(folder, 'package.json'))) return folder;

  const parent = path.dirname(folder);
  return parent === folder ? undefined : findPackageOf(parent);
};

/** the folder of a package and of every package of the repository it depends on, each found where the one that depends on it would load it from, through its links */
const findPackages = (folder: string): string[] => {
  const dependencies = Object.keys(read(folder).dependencies ?? {}).filter((name) => name.startsWith(PREFIX));

  return [
    folder,
    ...dependencies.flatMap((name) => {
      const found = findInstalledPackage(folder, name);
      if (!found) throw new Error(`${name} is not installed where ${folder} would load it from.`);

      return findPackages(fs.realpathSync(found));
    }),
  ];
};

/**
 * The versions of the packages of the server as they are installed now for the script that runs it, which an update changes while the processes that run keep their code: of the
 * package of the script when it is one of the repository (the command line), of the server and of what it runs on. The script is followed through links, so that a link that
 * points to a new release says what is there. Throws while an update is not complete enough to be read.
 */
const readServerVersion = (script: string = process.argv[1]): string => {
  const folder = path.dirname(fs.realpathSync(script));
  const server = fs.realpathSync(findInstalledPackage(folder, SERVER) ?? PACKAGE_ROOT);
  const own = findPackageOf(folder);
  const ofTheScript = own && read(own).name?.startsWith(PREFIX) ? [own] : [];
  // the package of the script alone: what it depends on is the server, which is looked up for itself
  const versions = [...ofTheScript, ...findPackages(server)].map(read).map(({ name, version }) => `${name}@${version}`);

  return Array.from(new Set(versions)).join(' ');
};

export default readServerVersion;
