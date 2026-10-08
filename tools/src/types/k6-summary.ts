/** the values k6 exports for a metric with `--summary-export`, which ones are there depends on the type of the metric */
export interface Metric {
  count?: number;
  rate?: number;
  value?: number;
  passes?: number;
  fails?: number;
  avg?: number;
  med?: number;
  max?: number;
  'p(90)'?: number;
  'p(95)'?: number;
  /** maps an expression to whether it was breached */
  thresholds?: Record<string, boolean>;
}

export type Metrics = Record<string, Metric | undefined>;

export interface K6Summary {
  metrics: Metrics;
}
