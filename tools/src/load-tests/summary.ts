import { existsSync, readFileSync } from 'node:fs';
import type { K6Summary, Metric } from './k6-summary';

const [summaryPath = 'k6-summary.json', serverLogPath, title = 'Load test'] = process.argv.slice(2);

if (!existsSync(summaryPath)) {
  console.log(`## ${title}\n\n❌ No k6 summary was produced, the run failed before or during the test. Check the step logs.`);
  process.exit(0);
}

const { metrics }: K6Summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const { http_reqs: requests, http_req_failed: failed, http_req_duration: duration, checks, data_received: received } = metrics;
const ms = (value: number | undefined) => (value === undefined ? 'n/a' : `${value.toFixed(1)} ms`);
const percent = (value = 0) => `${(value * 100).toFixed(2)}%`;
// in the summary export a threshold maps to whether it was breached
const thresholds = Object.entries(metrics).flatMap(([metric, values]) =>
  Object.entries(values?.thresholds ?? {}).map(([expression, breached]) => `| \`${metric}\` | \`${expression}\` | ${breached ? '❌ failed' : '✅ passed'} |`)
);
const routes = Object.entries(metrics)
  .map(([metric, values]) => [metric.match(/^http_req_duration\{route:(.+)\}$/)?.[1], values] as const)
  .flatMap(([route, values]) => (route === undefined ? [] : [`| ${route} | ${ms(values?.med)} | ${ms(values?.['p(95)'])} | ${ms(values?.max)} |`]));
const { ws_sessions: sessions, ws_session_ok: sessionsOk, ws_msgs_received: frames, ws_connecting: connecting, ws_session_duration: sessionDuration } = metrics;
const websocket =
  sessions === undefined
    ? []
    : [
        '### WebSocket',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Sessions | ${sessions.count ?? 0} (${sessionsOk?.passes ?? 0} ok, ${sessionsOk?.fails ?? 0} failed) |`,
        `| Frames received | ${frames?.count ?? 0} |`,
        `| Connect time median / p95 / max | ${ms(connecting?.med)} / ${ms(connecting?.['p(95)'])} / ${ms(connecting?.max)} |`,
        `| Session duration avg | ${sessionDuration?.avg === undefined ? 'n/a' : `${(sessionDuration.avg / 1000).toFixed(2)} s`} |`,
        '',
      ];
const breachedCount = Object.values(metrics)
  .flatMap((values) => Object.values(values?.thresholds ?? {}))
  .filter(Boolean).length;
// the log of the server is only looked at when there is one
const serverErrors =
  serverLogPath && existsSync(serverLogPath)
    ? readFileSync(serverLogPath, 'utf8')
        .split('\n')
        .filter((line) => /\b(Error|TypeError|500 Internal Server Error)\b/.test(line))
    : undefined;
const serverLog =
  serverErrors === undefined
    ? []
    : [
        serverErrors.length === 0
          ? '### Server log\n\nNo errors logged.'
          : `### Server log\n\n${serverErrors.length} error line(s), first ones:\n\n\`\`\`\n${serverErrors.slice(0, 5).join('\n')}\n\`\`\``,
      ];

console.log(
  [
    `## ${title} ${breachedCount === 0 ? '✅ passed' : '❌ failed'}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Requests | ${requests?.count ?? 0} (${(requests?.rate ?? 0).toFixed(0)} req/s) |`,
    `| Failed requests | ${failed?.passes ?? 0} (${percent(failed?.value)}) |`,
    `| Checks passed | ${percent(checks?.value)} |`,
    `| Latency avg / median | ${ms(duration?.avg)} / ${ms(duration?.med)} |`,
    `| Latency p90 / p95 | ${ms(duration?.['p(90)'])} / ${ms(duration?.['p(95)'])} |`,
    `| Latency max | ${ms(duration?.max)} |`,
    `| Data received | ${((received?.count ?? 0) / 1024 / 1024).toFixed(1)} MiB |`,
    '',
    ...(routes.length === 0 ? [] : ['### Latency per route', '', '| Route | Median | p95 | Max |', '| --- | --- | --- | --- |', ...routes, '']),
    ...websocket,
    '### Thresholds',
    '',
    '| Metric | Expression | Result |',
    '| --- | --- | --- |',
    ...thresholds,
    '',
    ...serverLog,
  ].join('\n')
);
