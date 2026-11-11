const has = (flag: string) => process.allowedNodeEnvironmentFlags.has(flag);

/**
 * The flags that make a lambda process read-only except for its own folders, the way the code of a function on AWS is read-only and only `/tmp` is writable.
 * It can read everything (a handler needs the `node_modules` above its folder, which AWS would bundle). It may start child processes, workers and addons as it can on AWS.
 * Nothing when the node running does not have the permission model.
 */
const createPermissionFlags = (writableFolders: string[]) => {
  const permission = ['--permission', '--experimental-permission'].find(has);

  if (permission === undefined) return [];

  return [
    permission,
    '--allow-fs-read=*',
    ...writableFolders.map((folder) => `--allow-fs-write=${folder}`),
    ...['--allow-child-process', '--allow-worker', '--allow-addons'].filter(has),
    // these flags make node warn on every start of a lambda
    ...['--disable-warning'].filter(has).map((flag) => `${flag}=SecurityWarning`),
  ];
};

export default createPermissionFlags;
