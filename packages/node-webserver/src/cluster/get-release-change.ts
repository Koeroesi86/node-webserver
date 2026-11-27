import describeVersionChange from './describe-version-change';
import type { FrontRelease } from '../types';

/** what a replacement found that differs from the server that runs, undefined when nothing does */
const getReleaseChange = (expected: FrontRelease, found: FrontRelease) => {
  if (expected.version !== found.version) return `the version of the installed server changed: ${describeVersionChange(expected.version, found.version)}`;

  return expected.configuration === found.configuration ? undefined : 'the configuration is another one than the running one';
};

export default getReleaseChange;
