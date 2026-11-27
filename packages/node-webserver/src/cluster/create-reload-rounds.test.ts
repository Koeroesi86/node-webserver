import createReloadRounds from './create-reload-rounds';
import createMockLogger from '../observability/mock-logger.test-helper';
import { RELOAD_DEBOUNCE, RELOAD_ROUND_RETRIES, RELOAD_ROUND_TIMEOUT } from '../constants';

describe('createReloadRounds', () => {
  const logger = createMockLogger();
  const send = jest.fn();
  const kill = jest.fn();
  const stopWatching = jest.fn();
  let change = () => {};
  const watch = jest.fn((_files: string[], onChange: () => void) => {
    change = onChange;
    return stopWatching;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  /** rounds of two fronts that serve what the same files gave */
  const create = (options: Partial<Parameters<typeof createReloadRounds>[0]> = {}) => {
    const rounds = createReloadRounds({ logger, send, kill, watch, ...options });
    rounds.serving(0, { files: ['a.js'], fingerprint: 'running', singleFrontOnly: false, targets: [] });
    rounds.serving(1, { files: ['a.js', 'b.js'], fingerprint: 'running', singleFrontOnly: false, targets: [] });
    rounds.start();
    return rounds;
  };

  const sent = () => send.mock.calls.map(([{ nodeWebserver, round }, index]) => `${nodeWebserver} ${round} to ${index}`);
  const prepared = (rounds: ReturnType<typeof create>, index: number, round: number, fingerprint = 'new') =>
    rounds.message(index, { nodeWebserver: 'prepared', round, fingerprint });

  it('watches the files all the fronts name, and nothing starts when they started with the same', () => {
    create();

    expect(watch).toHaveBeenLastCalledWith(['a.js', 'b.js'], expect.any(Function));
    expect(send).not.toHaveBeenCalled();
  });

  it('watches anew when a front names other files', () => {
    const rounds = create();
    watch.mockClear();

    rounds.message(0, { nodeWebserver: 'files', files: ['c.js'], singleFrontOnly: false, targets: [] });

    expect(stopWatching).toHaveBeenCalled();
    expect(watch).toHaveBeenLastCalledWith(['c.js', 'a.js', 'b.js'], expect.any(Function));
  });

  it('watches the files anew before it stops watching them, so that no change is dropped in between', () => {
    const rounds = create();
    watch.mockClear();
    stopWatching.mockClear();

    rounds.message(0, { nodeWebserver: 'files', files: ['c.js'], singleFrontOnly: false, targets: [] });

    expect(watch.mock.invocationCallOrder[0]).toBeLessThan(stopWatching.mock.invocationCallOrder[0]);
  });

  it('asks all fronts to prepare once the changes settled, and to serve it once all of them did', () => {
    const rounds = create();

    change();
    change();
    jest.advanceTimersByTime(RELOAD_DEBOUNCE);
    prepared(rounds, 0, 1);
    expect(sent()).toEqual(['prepare 1 to 0', 'prepare 1 to 1']);
    prepared(rounds, 1, 1);

    expect(sent().slice(2)).toEqual(['commit 1 to 0', 'commit 1 to 1']);
    expect(logger.system).toHaveBeenCalledWith(expect.stringContaining('loaded again in 2 fronts'));
  });

  it('keeps the running servers in every front when one of them cannot load', () => {
    const rounds = create();
    rounds.request();

    rounds.message(0, { nodeWebserver: 'prepare-failed', round: 1, reason: 'broken' });
    prepared(rounds, 1, 1);
    jest.runAllTimers();

    expect(sent().slice(2)).toEqual(['discard 1 to 0', 'discard 1 to 1']);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('front 1 could not load them (broken)'));
  });

  it('tries again at once, a limited number of times, when the fronts did not load the same', () => {
    const rounds = create();
    rounds.request();

    Array.from({ length: RELOAD_ROUND_RETRIES + 1 }, (_, index) => index + 1).forEach((round) => {
      prepared(rounds, 0, round, 'one');
      prepared(rounds, 1, round, 'other');
    });

    expect(sent().filter((message) => message.startsWith('prepare'))).toHaveLength((RELOAD_ROUND_RETRIES + 1) * 2);
    expect(sent().filter((message) => message.startsWith('commit'))).toHaveLength(0);
    expect(logger.error).toHaveBeenLastCalledWith(expect.stringContaining('waiting for the next change'));
  });

  it('has all its tries again after a change', () => {
    const rounds = create();
    const mismatch = (round: number) => {
      prepared(rounds, 0, round, 'one');
      prepared(rounds, 1, round, 'other');
    };
    rounds.request();
    Array.from({ length: RELOAD_ROUND_RETRIES + 1 }, (_, index) => mismatch(index + 1));
    change();
    jest.advanceTimersByTime(RELOAD_DEBOUNCE);
    send.mockClear();

    mismatch(RELOAD_ROUND_RETRIES + 2);

    expect(sent().filter((message) => message.startsWith('prepare'))).toHaveLength(2);
  });

  it('runs one round at a time, and another one for what asked meanwhile', () => {
    const rounds = create();

    rounds.request();
    rounds.message(0, { nodeWebserver: 'reload-request' });
    rounds.request();
    expect(sent()).toHaveLength(2);
    prepared(rounds, 0, 1);
    prepared(rounds, 1, 1);

    expect(sent().slice(2)).toEqual(['commit 1 to 0', 'commit 1 to 1', 'prepare 2 to 0', 'prepare 2 to 1']);
  });

  it('ignores an answer of another round, and a second one of a front', () => {
    const rounds = create();
    rounds.request();

    prepared(rounds, 0, 7);
    prepared(rounds, 0, 1);
    prepared(rounds, 0, 1);

    expect(sent()).toHaveLength(2);
  });

  it('replaces a front that does not answer in time, and keeps the running servers', () => {
    const rounds = create();
    rounds.request();
    prepared(rounds, 0, 1);

    jest.advanceTimersByTime(RELOAD_ROUND_TIMEOUT);

    expect(kill.mock.calls).toEqual([[1]]);
    expect(sent().slice(2)).toEqual(['discard 1 to 0', 'discard 1 to 1']);
    rounds.exited(1);
    rounds.serving(1, { files: [], fingerprint: 'new', singleFrontOnly: false, targets: [] });
    expect(sent().slice(4)).toEqual(['prepare 2 to 0', 'prepare 2 to 1']);
  });

  it('keeps the running servers when a front ends during a round, and goes on with the ones that serve', () => {
    const rounds = create();
    rounds.request();
    prepared(rounds, 0, 1);

    rounds.exited(1);
    rounds.exited(1);
    rounds.request();

    expect(sent().slice(2)).toEqual(['discard 1 to 0', 'discard 1 to 1', 'prepare 2 to 0']);
  });

  it('runs a round once the first fronts serve when they did not load the same, or a change came while they started', () => {
    const differing = createReloadRounds({ logger, send, kill });
    differing.serving(0, { files: [], fingerprint: 'one', singleFrontOnly: false, targets: [] });
    differing.serving(1, { files: [], fingerprint: 'other', singleFrontOnly: false, targets: [] });
    expect(send).not.toHaveBeenCalled();
    differing.start();
    expect(sent()).toEqual(['prepare 1 to 0', 'prepare 1 to 1']);

    send.mockClear();
    const asked = createReloadRounds({ logger, send, kill });
    asked.serving(0, { files: [], fingerprint: 'one', singleFrontOnly: false, targets: [] });
    asked.request();
    asked.start();
    expect(sent()).toEqual(['prepare 1 to 0']);
  });

  it('waits for a front when none serves', () => {
    const rounds = createReloadRounds({ logger, send, kill });
    rounds.start();

    rounds.request();
    expect(send).not.toHaveBeenCalled();
    rounds.serving(0, { files: [], fingerprint: 'new', singleFrontOnly: false, targets: [] });

    expect(sent()).toEqual(['prepare 1 to 0']);
  });

  it('stops watching and runs nothing once stopped', () => {
    const rounds = create();
    rounds.request();
    send.mockClear();

    rounds.stop();
    jest.runAllTimers();
    rounds.request();
    prepared(rounds, 0, 1);

    expect(stopWatching).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('tells when a front found that the servers need another number of fronts, after the round', () => {
    const onRecount = jest.fn();
    const rounds = create({ onRecount });
    rounds.request();

    rounds.message(0, { nodeWebserver: 'prepare-failed', round: 1, reason: 'count', recount: true });
    expect(onRecount).not.toHaveBeenCalled();
    prepared(rounds, 1, 1);

    expect(onRecount).toHaveBeenCalledTimes(1);
    expect(sent().slice(2)).toEqual(['discard 1 to 0', 'discard 1 to 1']);
  });

  it('says whether a server of one of the fronts must not run twice', () => {
    const rounds = create();
    expect(rounds.isSingleFrontOnly()).toBe(false);

    rounds.message(1, { nodeWebserver: 'files', files: [], singleFrontOnly: true, targets: [] });

    expect(rounds.isSingleFrontOnly()).toBe(true);
  });
});
