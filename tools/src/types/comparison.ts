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

/** the runs of big-upload.ts and download.ts in the mode that keeps the connection: the bodies a worker reads from or writes to the client itself */
export interface TransferSummaries {
  baseUploads?: K6Summary[];
  headUploads?: K6Summary[];
  baseDownloads?: K6Summary[];
  headDownloads?: K6Summary[];
}

export interface TransferJudgement {
  /** starts the sentence of the regression */
  subject: string;
  label: string;
  /** the trend of the speed in MB/s, of which the `keep-alive` mode is judged */
  metric: string;
  /** the prefix of the checks of the scenario, which tell whether the answers of the base are real ones */
  checks: string;
  baseRuns: K6Summary[];
  headRuns: K6Summary[];
  limits: Limits;
}

export interface SummaryPaths {
  base: string[];
  head: string[];
  baseCpu?: string[];
  headCpu?: string[];
  baseBinary?: string[];
  headBinary?: string[];
  baseUploads?: string[];
  headUploads?: string[];
  baseDownloads?: string[];
  headDownloads?: string[];
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
  /** the duration of the big uploads and the big downloads, each on its own */
  transferDuration: string;
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

/** the rows of the table and the regressions found by judging one metric */
export interface Judgement {
  rows: string[];
  regressions: string[];
}

export interface P95Judgement {
  /** starts the sentence of the regression */
  subject: string;
  label: string;
  base: number | undefined;
  head: number | undefined;
  comparable: boolean;
  maxIncrease: number;
  minDifferenceMs: number;
}

export interface JudgedRow {
  label: string;
  base: number | undefined;
  head: number | undefined;
  /** false when the base cannot serve what is measured, so there is nothing to compare with */
  comparable: boolean;
  failed: boolean;
  digits?: number;
}

export interface JudgedMetrics {
  limits: Limits;
  cpuRuns?: { base: number; head: number };
  binaryRuns?: { base: number; head: number };
  transferRuns?: { base: number; head: number };
}
