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

export interface SummaryPaths {
  base: string[];
  head: string[];
  baseCpu?: string[];
  headCpu?: string[];
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
  resultsDirectory: string;
  portHttp: string;
  portHttps: string;
  serverPrefix: string[];
  k6Prefix: string[];
}

export interface ComparisonDetails extends ComparisonResult {
  regressions: string[];
}
