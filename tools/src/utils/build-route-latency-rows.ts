import { routeDurationPattern } from '../constants/load-test';
import type { Metrics } from '../types/k6-summary';
import { formatMs } from './format-ms';

export const buildRouteLatencyRows = (metrics: Metrics) =>
  Object.entries(metrics)
    .map(([metric, values]) => [metric.match(routeDurationPattern)?.[1], values] as const)
    .flatMap(([route, values]) =>
      route === undefined ? [] : [`| ${route} | ${formatMs(values?.med)} | ${formatMs(values?.['p(95)'])} | ${formatMs(values?.max)} |`]
    );
