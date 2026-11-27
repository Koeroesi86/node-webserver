import { rm, writeFile } from 'fs/promises';
import { getDate } from '../utils';
import type { Logger, TargetFile } from '../types';

/** the file a registered target is kept in, so that it survives a restart. One write after the other, so that the file ends with the last target. */
const createTargetFile = (persistPath: string, logger: Logger): TargetFile => {
  let saving = Promise.resolve();

  return {
    save: ({ target, setAt, expiresAt }) => {
      saving = saving
        .then(() => (target ? writeFile(persistPath, JSON.stringify({ target, setAt, expiresAt }), 'utf8') : rm(persistPath, { force: true })))
        .catch((error) => logger.error(`[${getDate()}] The target cannot be kept in ${persistPath}:`, error));
    },
    saved: () => saving,
  };
};

export default createTargetFile;
