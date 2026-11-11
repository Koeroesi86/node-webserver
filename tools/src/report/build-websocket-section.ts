import type { Metrics } from '../types/k6-summary';
import { formatMs } from './format-ms';

/** empty when the run had no WebSocket scenario */
export const buildWebsocketSection = (metrics: Metrics) => {
  const {
    ws_sessions: sessions,
    ws_session_ok: sessionsOk,
    ws_msgs_received: frames,
    ws_connecting: connecting,
    ws_session_duration: sessionDuration,
  } = metrics;
  if (sessions === undefined) return [];

  return [
    '### WebSocket',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Sessions | ${sessions.count ?? 0} (${sessionsOk?.passes ?? 0} ok, ${sessionsOk?.fails ?? 0} failed) |`,
    `| Frames received | ${frames?.count ?? 0} |`,
    `| Connect time median / p95 / max | ${formatMs(connecting?.med)} / ${formatMs(connecting?.['p(95)'])} / ${formatMs(connecting?.max)} |`,
    `| Session duration avg | ${sessionDuration?.avg === undefined ? 'n/a' : `${(sessionDuration.avg / 1000).toFixed(2)} s`} |`,
    '',
  ];
};
