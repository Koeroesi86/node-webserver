/** the part of the istanbul `coverage-final.json` entry of a file that the report needs */
export interface FileCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}

export interface FileSummary {
  file: string;
  lines: number;
  coveredLines: number;
  uncoveredLines: number[];
}

export interface PackageCoverage {
  name: string;
  files: FileSummary[];
}
