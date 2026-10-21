import { EXTRA_ENTRIES } from '../constants/package-entries';
import type { PackageJson } from '../types/version';

/** what is wrong with the `exports` of a package: it has to be the one primary entry (`.`), the ones of EXTRA_ENTRIES and package.json, never a file of `dist` */
export const findEntryProblems = ({ name, exports, main, bin }: PackageJson): string[] => {
  if (typeof exports !== 'object' || exports === null) return [`${name}: no exports map, every file of the package can be imported`];
  const allowed = ['.', './package.json', ...(EXTRA_ENTRIES[name] ?? [])];
  const keys = Object.keys(exports);
  const isExecutable = bin !== undefined && main === undefined;

  return [
    ...keys.filter((key) => !allowed.includes(key)).map((key) => `${name}: ${key} is not an entry of the package (see EXTRA_ENTRIES)`),
    ...(keys.includes('.') || isExecutable ? [] : [`${name}: no primary entry (.)`]),
  ];
};
