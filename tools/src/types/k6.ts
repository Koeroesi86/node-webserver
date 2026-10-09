/** how k6 is run: the binary that is installed, or the official image in Docker */
export type K6Runner = 'native' | 'docker';

export interface K6CommandOptions {
  runner: K6Runner;
  /** the folder of the scenarios (`tools/src/k6`) */
  scriptsDirectory: string;
  /** the scenario in it, `example.ts` */
  script: string;
  /** the arguments for `k6 run`, before the scenario */
  args: string[];
  image: string;
}

export interface LoadTestOptions {
  /** the root of the repository */
  root: string;
  duration: string;
  portHttp: string;
  portHttps: string;
  /** chosen from what is installed when omitted */
  runner?: K6Runner;
}
