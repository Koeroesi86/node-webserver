import type { K6Summary } from './k6-summary';

export interface Limits {
  maxThroughputDrop: number;
  maxP95Increase: number;
  maxCpuP95Increase: number;
  minP95DifferenceMs: number;
  minCheckRate: number;
}

export interface CpuSummaries {
  baseCpu?: K6Summary[];
  headCpu?: K6Summary[];
}

/** the runs of binary.ts, big binary responses from a worker */
export interface BinarySummaries {
  baseBinary?: K6Summary[];
  headBinary?: K6Summary[];
}

export interface SummaryPaths {
  base: string[];
  head: string[];
  baseCpu?: string[];
  headCpu?: string[];
  baseBinary?: string[];
  headBinary?: string[];
}

export interface ComparisonResult {
  markdown: string;
  passed: boolean;
}

export interface ComparisonOptions {
  /** the checkout of the base */
  base: string;
  /** the checkout of the pull request, which also has the k6 scripts and the comparison that are used */
  head: string;
  rounds: number;
  duration: string;
  cpuDuration: string;
  binaryDuration: string;
  resultsDirectory: string;
  portHttp: string;
  portHttps: string;
  serverPrefix: string[];
  k6Prefix: string[];
  /** variables for the servers of both sides, on top of the environment: a setting that the base has to know as well to be compared with */
  serverEnvironment?: Record<string, string>;
  /** only example.ts is run, not the CPU bound and the binary scenarios: for a setting that is about what every request goes through */
  mainOnly?: boolean;
}

export interface ComparisonDetails extends ComparisonResult {
  regressions: string[];
}
