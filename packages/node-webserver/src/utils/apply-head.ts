import type { HeaderChanges, HeaderMap } from '../types';

/** the head to write: the given headers without the ones that are to be replaced, and the replacements that are not removals */
const applyHead = (given: HeaderMap | undefined, changes: HeaderChanges): HeaderMap => {
  const replaced = new Set(Object.keys(changes).map((name) => name.toLowerCase()));
  const kept = Object.entries(given ?? {}).filter(([name]) => !replaced.has(name.toLowerCase()));

  return { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
};

export default applyHead;
