import type { Configuration } from '../types';
import getMaxFronts from './get-max-fronts';

/** the fronts the configuration asks for, before the limits of the servers: its number, or the most the cores allow for `auto`. One without the setting. */
const getRequestedFronts = ({ frontProcesses = 1 }: Pick<Configuration, 'frontProcesses'>, cores?: number) =>
  frontProcesses === 'auto' ? getMaxFronts(cores) : Math.min(frontProcesses, getMaxFronts(cores));

export default getRequestedFronts;
