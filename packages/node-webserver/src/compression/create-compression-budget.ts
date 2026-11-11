import type { CompressionBudget } from '../types';

/**
 * the places for the responses a server compresses at the same time. zlib runs on the threadpool of node, which the file system and DNS share: a cap keeps
 * a burst of compressed responses from queueing the reads of files behind it. One for each server, so that the cap of a second server in the process does
 * not count the responses of this one.
 */
const createCompressionBudget = (): CompressionBudget => {
  let active = 0;

  return {
    getActive: () => active,
    acquire: () => {
      let released = false;
      active += 1;

      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
};

export default createCompressionBudget;
