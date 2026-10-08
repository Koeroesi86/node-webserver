export interface CpuTimes {
  total: number;
  steal: number;
}

export interface Snapshot {
  cpuModel: string;
  cores: number;
  times?: CpuTimes;
}
