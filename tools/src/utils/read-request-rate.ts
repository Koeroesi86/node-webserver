import type { K6Summary } from '../types/k6-summary';
import { readFile } from './read-file';

/** the requests per second of a k6 summary export for the log, or what is wrong with it */
export const readRequestRate = (path: string) => {
  try {
    const summary: K6Summary = JSON.parse(readFile(path) ?? '');

    return `${Math.round(summary.metrics.http_reqs?.rate ?? NaN)} req/s`;
  } catch {
    return 'no summary';
  }
};
