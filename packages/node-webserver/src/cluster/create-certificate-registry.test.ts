import createCertificateRegistry from './create-certificate-registry';
import { CHALLENGE_TIMEOUT } from '../constants';
import type { CertificateServer } from '../types';

describe('createCertificateRegistry', () => {
  const onNewServer = jest.fn();
  const server = (hostname: string, email = 'a@example.com'): CertificateServer => ({ hostname, protocol: 'https', acme: { email, storagePath: '/acme' } });
  const taken = { nodeWebserver: 'challenge-taken' as const, token: 'token' };

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  /** two fronts that listen */
  const joinTwo = () => {
    const registry = createCertificateRegistry(onNewServer);
    const sends = [jest.fn(), jest.fn()];
    const members = sends.map((send) => registry.join(send));
    members.forEach((member) => member.hello());
    return { registry, sends, members };
  };

  const settled = async (promise: unknown) => {
    const done = jest.fn();
    void Promise.resolve(promise).then(done);
    await new Promise(process.nextTick);
    return done.mock.calls.length > 0;
  };

  it('has every front answer a challenge before it is set', async () => {
    const { registry, sends, members } = joinTwo();

    const set = registry.challenges.set('token', 'answer');

    expect(sends.map((send) => send.mock.calls)).toEqual(Array(2).fill([[{ nodeWebserver: 'challenge', token: 'token', answer: 'answer' }]]));
    members[0].receive(taken);
    expect(await settled(set)).toBe(false);
    members[1].receive(taken);
    expect(await settled(set)).toBe(true);
  });

  it('does not wait for a front that left, nor longer than a while for one that says nothing', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const { registry, members } = joinTwo();

    const first = registry.challenges.set('token', 'answer');
    members[0].receive(taken);
    members[1].leave();
    expect(await settled(first)).toBe(true);

    const second = registry.challenges.set('token', 'answer');
    jest.advanceTimersByTime(CHALLENGE_TIMEOUT);
    expect(await settled(second)).toBe(true);
  });

  it('is set at once without a front that listens', async () => {
    const registry = createCertificateRegistry(onNewServer);
    registry.join(jest.fn());

    expect(await settled(registry.challenges.set('token', 'answer'))).toBe(true);
  });

  it('tells a front that comes during an order the challenge, and all of them when it is done', () => {
    const { registry, sends } = joinTwo();
    void registry.challenges.set('token', 'answer');
    const late = jest.fn();
    const member = registry.join(late);
    expect(late).not.toHaveBeenCalled();

    member.hello();
    registry.challenges.delete('token');
    registry.join(jest.fn()).hello();

    expect(late.mock.calls).toEqual([[{ nodeWebserver: 'challenge', token: 'token', answer: 'answer' }], [{ nodeWebserver: 'challenge', token: 'token' }]]);
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'challenge', token: 'token' });
    registry.challenges.delete('token');
  });

  it('knows the servers of its fronts, one for each certificate, the last one that was named', () => {
    const { registry, members } = joinTwo();

    members[0].serves({ targets: [], certificates: [server('a.example.com'), server('b.example.com')] });
    members[1].serves({ targets: [], certificates: [server('a.example.com', 'new@example.com')] });

    expect(registry.getServers()).toEqual([server('a.example.com', 'new@example.com'), server('b.example.com')]);
    members[0].leave();
    expect(registry.getServers()).toEqual([server('a.example.com', 'new@example.com')]);
  });

  it('says when it hears of a server for the first time, not when a front says it again or comes back with it', () => {
    const { registry, members } = joinTwo();

    members[0].serves({ targets: [], certificates: [server('a.example.com')] });
    members[1].serves({ targets: [], certificates: [server('a.example.com')] });
    members[0].leave();
    registry.join(jest.fn()).serves({ targets: [], certificates: [server('a.example.com')] });
    expect(onNewServer).toHaveBeenCalledTimes(1);

    members[1].serves({ targets: [], certificates: [server('b.example.com')] });
    expect(onNewServer).toHaveBeenCalledTimes(2);
  });
});
