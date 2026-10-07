const { existsSync, readFileSync } = require('fs');

const [summaryPath = 'k6-summary.json', serverLogPath = 'server.log'] = process.argv.slice(2);

if (!existsSync(summaryPath)) {
  console.log('## Load test\n\n❌ No k6 summary was produced, the run failed before or during the test. Check the step logs.');
  process.exit(0);
}

const { metrics } = JSON.parse(readFileSync(summaryPath, 'utf8'));
const { http_reqs: requests, http_req_failed: failed, http_req_duration: duration, checks, data_received: received } = metrics;
const ms = (value) => (value === undefined ? 'n/a' : `${value.toFixed(1)} ms`);
const percent = (value) => `${(value * 100).toFixed(2)}%`;
// in the summary export a threshold maps to whether it was breached
const thresholds = Object.entries(metrics).flatMap(([metric, { thresholds: results = {} }]) =>
  Object.entries(results).map(([expression, breached]) => `| \`${metric}\` | \`${expression}\` | ${breached ? '❌ failed' : '✅ passed'} |`)
);
const breachedCount = Object.values(metrics)
  .flatMap(({ thresholds: results = {} }) => Object.values(results))
  .filter(Boolean).length;
const serverErrors = existsSync(serverLogPath)
  ? readFileSync(serverLogPath, 'utf8')
      .split('\n')
      .filter((line) => /\b(Error|TypeError|500 Internal Server Error)\b/.test(line))
  : [];

console.log(
  [
    `## Load test ${breachedCount === 0 ? '✅ passed' : '❌ failed'}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Requests | ${requests.count} (${requests.rate.toFixed(0)} req/s) |`,
    `| Failed requests | ${failed.passes} (${percent(failed.value)}) |`,
    `| Checks passed | ${percent(checks.value)} |`,
    `| Latency avg / median | ${ms(duration.avg)} / ${ms(duration.med)} |`,
    `| Latency p90 / p95 | ${ms(duration['p(90)'])} / ${ms(duration['p(95)'])} |`,
    `| Latency max | ${ms(duration.max)} |`,
    `| Data received | ${(received.count / 1024 / 1024).toFixed(1)} MiB |`,
    '',
    '### Thresholds',
    '',
    '| Metric | Expression | Result |',
    '| --- | --- | --- |',
    ...thresholds,
    '',
    serverErrors.length === 0 ? '### Server log\n\nNo errors logged.' : `### Server log\n\n${serverErrors.length} error line(s), first ones:\n\n\`\`\`\n${serverErrors.slice(0, 5).join('\n')}\n\`\`\``,
  ].join('\n')
);
