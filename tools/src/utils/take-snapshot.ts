import { availableParallelism } from 'node:os';
import type { Snapshot } from '../types/runner';
import { getCpuModel } from './get-cpu-model';
import { getCpuTimes } from './get-cpu-times';
import { readFile } from './read-file';

export const takeSnapshot = (statPath = '/proc/stat', cpuInfoPath = '/proc/cpuinfo'): Snapshot => ({
  cpuModel: getCpuModel(readFile(cpuInfoPath)),
  cores: availableParallelism(),
  times: getCpuTimes(readFile(statPath)),
});
