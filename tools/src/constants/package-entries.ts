/** the entries a package publishes besides its root and its package.json, so that moving a file in it is never a breaking change */
export const EXTRA_ENTRIES: Record<string, string[]> = {
  '@koeroesi86/node-worker': ['./pool'],
  '@koeroesi86/node-webserver': ['./configuration.schema.json'],
};
