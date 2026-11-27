import type { Decision, ServerPlan } from '../types';

interface Change {
  /** the plan of the server that runs */
  running: ServerPlan;
  /** whether one of the servers that run now must not run twice, which a reload can have changed since it started */
  singleFrontOnly: boolean;
  /** the plan of the configuration and the server files as they are now */
  next: ServerPlan;
  /** the version of the primary */
  version: string;
  /** whether new fronts are needed although nothing seems to differ: one of them could not take the place of another */
  force: boolean;
}

/**
 * What a change of the configuration takes: nothing, new fronts next to the ones that run, or a restart of the whole server, which pauses it. A restart is for what two sets of fronts
 * cannot do side by side, or what the primary cannot change while it runs.
 */
const decideChange = ({ running, singleFrontOnly, next, version, force }: Change): Decision => {
  if (next.problems.some(({ severity }) => severity === 'error')) return { action: 'invalid' };

  const changed = force || next.filesFingerprint !== running.filesFingerprint || next.frontCount !== running.frontCount || next.release.version !== version;

  if (!changed) return { action: 'keep' };
  if (next.release.version !== version) return { action: 'restart', reason: `the server is version ${next.release.version} now, the running one ${version}` };
  if (next.balanced !== running.balanced) return { action: 'restart', reason: 'frontProcesses changed between one front and several' };
  if (singleFrontOnly || next.singleFrontOnly) {
    return { action: 'restart', reason: 'a child server cannot run in two sets of fronts at once' };
  }

  return { action: 'switch' };
};

export default decideChange;
