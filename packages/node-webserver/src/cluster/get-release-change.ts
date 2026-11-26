import type { FrontRelease } from '../types';

/** what a replacement found that differs from the server that runs, undefined when nothing does */
const getReleaseChange = (expected: FrontRelease, found: FrontRelease) => {
  if (expected.version !== found.version) return `the server is version ${found.version} now, the running one ${expected.version}`;

  return expected.configuration === found.configuration ? undefined : 'the configuration is another one than the running one';
};

export default getReleaseChange;
