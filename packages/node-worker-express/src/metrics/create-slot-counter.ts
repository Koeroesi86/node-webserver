/** Counts what is in use per key against a limit (0 for none). `take` gives back the function that frees the slot, once, or undefined when the key has no room left. */
const createSlotCounter = (limit: number) => {
  const taken = new Map<string, number>();

  return {
    take: (key: string) => {
      const count = taken.get(key) ?? 0;
      if (limit > 0 && count >= limit) return undefined;

      taken.set(key, count + 1);
      let released = false;

      return () => {
        if (released) return;
        released = true;
        const remaining = (taken.get(key) ?? 1) - 1;
        if (remaining > 0) taken.set(key, remaining);
        else taken.delete(key);
      };
    },
  };
};

export default createSlotCounter;
