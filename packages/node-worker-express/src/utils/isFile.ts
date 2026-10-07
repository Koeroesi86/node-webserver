import fs from 'fs/promises';

const isFile = (fileName: string) =>
  fs
    .stat(fileName)
    .then((stats) => stats.isFile())
    .catch(() => false);

export default isFile;
