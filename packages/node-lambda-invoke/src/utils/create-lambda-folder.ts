import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LAMBDA_FOLDER_PREFIX } from '../constants';

/**
 * The folders of one lambda process: `tmp` is its `/tmp` (the only place it can write to), `storage` is for the `file` communication.
 * They are named after the server that made them, so that another server never touches them.
 */
const createLambdaFolder = (withStorage: boolean) => {
  const root = mkdtempSync(join(tmpdir(), `${LAMBDA_FOLDER_PREFIX}${process.pid}-`));
  const tmp = join(root, 'tmp');
  const storage = join(root, 'storage');
  mkdirSync(tmp);
  if (withStorage) mkdirSync(storage);

  return { root, tmp, storage: withStorage ? storage : undefined };
};

export default createLambdaFolder;
