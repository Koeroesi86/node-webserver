/** the words of `NAME=value NAME=value` as an object, the words without a name before the `=` are left out */
export const parseAssignments = (value: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (value?.split(/\s+/) ?? [])
      .map((word) => [word.slice(0, Math.max(word.indexOf('='), 0)), word.slice(word.indexOf('=') + 1)])
      .filter(([name]) => name !== '')
  );
