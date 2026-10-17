import { existsSync, readFileSync } from 'node:fs';
import type { K6Summary } from '../types/k6-summary';
import { buildRouteLatencyRows } from './build-route-latency-rows';
import { buildServerLogSection } from './build-server-log-section';
import { buildThresholdRows } from './build-threshold-rows';
import { buildTransferSection } from './build-transfer-section';
import { buildWebsocketSection } from './build-websocket-section';
import { formatMs } from './format-ms';

const percent = (value = 0) => `${(value * 100).toFixed(2)}%`;

/** the markdown for the job summary of a k6 summary export, and the errors in the log of the server when there is one */
export const buildSummaryReport = (summaryPath: string, serverLogPath: string | undefined, title = 'Load test') => {
  if (!existsSync(summaryPath)) return `## ${title}\n\n❌ No k6 summary was produced, the run failed before or during the test. Check the step logs.`;

  const { metrics }: K6Summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const { http_reqs: requests, http_req_failed: failed, http_req_duration: duration, checks, data_received: received } = metrics;
  const breachedCount = Object.values(metrics)
    .flatMap((values) => Object.values(values?.thresholds ?? {}))
    .filter(Boolean).length;
  const routes = buildRouteLatencyRows(metrics);

  return [
    `## ${title} ${breachedCount === 0 ? '✅ passed' : '❌ failed'}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Requests | ${requests?.count ?? 0} (${(requests?.rate ?? 0).toFixed(0)} req/s) |`,
    `| Failed requests | ${failed?.passes ?? 0} (${percent(failed?.value)}) |`,
    `| Checks passed | ${percent(checks?.value)} |`,
    `| Latency avg / median | ${formatMs(duration?.avg)} / ${formatMs(duration?.med)} |`,
    `| Latency p90 / p95 | ${formatMs(duration?.['p(90)'])} / ${formatMs(duration?.['p(95)'])} |`,
    `| Latency max | ${formatMs(duration?.max)} |`,
    `| Data received | ${((received?.count ?? 0) / 1024 / 1024).toFixed(1)} MiB |`,
    '',
    ...(routes.length === 0 ? [] : ['### Latency per route', '', '| Route | Median | p95 | Max |', '| --- | --- | --- | --- |', ...routes, '']),
    ...buildWebsocketSection(metrics),
    ...buildTransferSection(metrics),
    '### Thresholds',
    '',
    '| Metric | Expression | Result |',
    '| --- | --- | --- |',
    ...buildThresholdRows(metrics),
    '',
    ...buildServerLogSection(serverLogPath),
  ].join('\n');
};
