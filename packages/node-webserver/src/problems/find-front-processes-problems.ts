import { getMaxFronts } from '../cluster';
import type { ConfigurationProblem, Configuration } from '../types';

/** more fronts than the machine runs. What is not a whole number of at least 1 or `auto` is reported by the schema. */
const findFrontProcessesProblems = (frontProcesses: Configuration['frontProcesses'], cores?: number): ConfigurationProblem[] => {
  const max = getMaxFronts(cores);

  if (typeof frontProcesses !== 'number' || frontProcesses <= max) return [];

  return [{ severity: 'error', setting: 'frontProcesses', message: `must be at most ${max} here, the smaller of 4 and the available cores` }];
};

export default findFrontProcessesProblems;
