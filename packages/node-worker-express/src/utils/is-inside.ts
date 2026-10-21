import path from 'path';

/** whether the path is the folder itself or something below it, after resolving any `..` */
const isInside = (folder: string, target: string) => {
  const relative = path.relative(path.resolve(folder), path.resolve(target));

  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

export default isInside;
