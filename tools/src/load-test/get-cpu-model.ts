import { cpus } from 'node:os';

/** the model of the processor, `/proc/cpuinfo` knows it on Linux */
export const getCpuModel = (cpuInfo: string | undefined) =>
  cpuInfo?.match(/^(?:model name|Model|Hardware)\s*:\s*(.+)$/m)?.[1].trim() ?? cpus()[0]?.model ?? 'unknown';
