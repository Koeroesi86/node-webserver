import { buildWebsocketSection } from './build-websocket-section';

describe('buildWebsocketSection', () => {
  it('is empty when the run had no WebSocket scenario', () => {
    expect(buildWebsocketSection({})).toEqual([]);
  });

  it('shows the sessions, the frames and the connect time', () => {
    const section = buildWebsocketSection({
      ws_sessions: { count: 3 },
      ws_session_ok: { passes: 2, fails: 1 },
      ws_msgs_received: { count: 9 },
      ws_connecting: { med: 1, 'p(95)': 2, max: 3 },
      ws_session_duration: { avg: 1500 },
    });

    expect(section).toContain('| Sessions | 3 (2 ok, 1 failed) |');
    expect(section).toContain('| Frames received | 9 |');
    expect(section).toContain('| Connect time median / p95 / max | 1.0 ms / 2.0 ms / 3.0 ms |');
    expect(section).toContain('| Session duration avg | 1.50 s |');
  });
});
