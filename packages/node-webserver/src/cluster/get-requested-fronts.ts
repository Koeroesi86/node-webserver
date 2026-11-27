import type { Configuration } from '../types';
import getMaxFronts from './get-max-fronts';

/** the fronts the configuration asks for, before the limits of the servers: its number, or the most the cores allow for `auto`, which it is without the setting. */
const getRequestedFronts = ({ frontProcesses = 'auto' }: Pick<Configuration, 'frontProcesses'>, cores?: number) =>
  frontProcesses === 'auto' ? getMaxFronts(cores) : Math.min(frontProcesses, getMaxFronts(cores));

export default getRequestedFronts;
