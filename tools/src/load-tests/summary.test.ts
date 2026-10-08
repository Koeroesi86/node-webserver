import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Metric, Metrics } from './k6-summary';

const trend = (median: number, p95: number, max: number, thresholds?: Record<string, boolean>): Metric => ({
  avg: median,
  med: median,
  'p(90)': p95,
  'p(95)': p95,
  max,
  ...(thresholds && { thresholds }),
});

const metrics = (breached = false): Metrics => ({
  http_reqs: { count: 1000, rate: 1234.5, thresholds: { 'rate>700': false } },
  http_req_failed: { passes: 2, fails: 998, value: 0.002, thresholds: { 'rate<0.001': breached } },
  http_req_duration: trend(5, 12, 90),
  'http_req_duration{route:worker}': trend(3, 8, 40, { 'p(95)<25': false }),
  'http_req_duration{route:secure}': trend(6, 20, 70, { 'p(95)<100': false }),
  checks: { passes: 998, fails: 2, value: 0.998 },
  data_received: { count: 5 * 1024 * 1024, rate: 1 },
  ws_sessions: { count: 40 },
  ws_session_ok: { passes: 39, fails: 1, value: 0.975 },
  ws_msgs_received: { count: 120 },
  ws_connecting: trend(8, 140, 200),
  ws_session_duration: { avg: 3520 },
});

describe('summary', () => {
  let folder = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'summary-'));
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const summarize = (summary: Metrics | undefined, serverLog?: string, title?: string) => {
    const summaryPath = join(folder, 'k6-summary.json');
    const logPath = join(folder, 'server.log');
    if (summary) writeFileSync(summaryPath, JSON.stringify({ metrics: summary }));
    if (serverLog !== undefined) writeFileSync(logPath, serverLog);

    const args = [summary ? summaryPath : join(folder, 'missing.json'), serverLog === undefined ? '' : logPath, ...(title ? [title] : [])];

    return execFileSync('node', [resolve(__dirname, '../../dist/load-tests/summary.js'), ...args], { encoding: 'utf8' });
  };

  it('reports the totals, the routes and the websocket sessions', () => {
    const output = summarize(metrics(), 'started\n');

    expect(output).toContain('## Load test ✅ passed');
    expect(output).toContain('| Requests | 1000 (1235 req/s) |');
    expect(output).toContain('| Failed requests | 2 (0.20%) |');
    expect(output).toContain('| worker | 3.0 ms | 8.0 ms | 40.0 ms |');
    expect(output).toContain('| secure | 6.0 ms | 20.0 ms | 70.0 ms |');
    expect(output).toContain('| Sessions | 40 (39 ok, 1 failed) |');
    expect(output).toContain('| Frames received | 120 |');
    expect(output).toContain('| Data received | 5.0 MiB |');
    expect(output).toContain('No errors logged.');
  });

  it('marks the run and the threshold as failed when a threshold was breached', () => {
    const output = summarize(metrics(true), '');

    expect(output).toContain('## Load test ❌ failed');
    expect(output).toContain('| `http_req_failed` | `rate<0.001` | ❌ failed |');
    expect(output).toContain('| `http_req_duration{route:worker}` | `p(95)<25` | ✅ passed |');
  });

  it('lists the errors of the server log', () => {
    const output = summarize(
      metrics(),
      ['fine', 'TypeError [ERR_INVALID_ARG_TYPE]: broken', '[http] RESPONSE GET / 500 Internal Server Error 1b sent', '404 Not Found'].join('\n')
    );

    expect(output).toContain('2 error line(s)');
    expect(output).toContain('TypeError [ERR_INVALID_ARG_TYPE]: broken');
    expect(output).not.toContain('404 Not Found');
  });

  it('leaves out the websocket section when there were no sessions', () => {
    const { ws_sessions, ...withoutWebsocket } = metrics();

    expect(summarize(withoutWebsocket, '')).not.toContain('### WebSocket');
  });

  it('explains that there was no summary when k6 did not produce one', () => {
    expect(summarize(undefined, '')).toContain('No k6 summary was produced');
  });

  it('uses the title it was given', () => {
    expect(summarize(metrics(), '', 'Load test: CPU bound worker')).toContain('## Load test: CPU bound worker ✅ passed');
    expect(summarize(undefined, '', 'Load test: CPU bound worker')).toContain('## Load test: CPU bound worker\n');
  });

  it('leaves out the server log section when there is no log', () => {
    expect(summarize(metrics(), undefined)).not.toContain('### Server log');
  });
});
