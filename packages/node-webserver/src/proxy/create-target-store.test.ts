import { once } from 'events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import createTargetStore from './create-target-store';
import createMockLogger from '../observability/mock-logger.test-helper';

describe('createTargetStore', () => {
  const logger = createMockLogger();

  let folder: string;
  let persistPath: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'target-store-'));
    persistPath = join(folder, 'target.json');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
  });

  it('keeps the agent of a target that is set again, and replaces it for another target', () => {
    const store = createTargetStore({ logger });
    const first = store.set(new URL('http://203.0.113.7:8080'));
    const again = store.set(new URL('http://203.0.113.7:8080'));
    const other = store.set(new URL('http://203.0.113.8:8080'));

    expect(again.agent).toBe(first.agent);
    expect(other.agent).not.toBe(first.agent);
    expect(store.get()).toBe(other);
  });

  it('forgets a target once it expired', () => {
    const store = createTargetStore({ logger });
    store.set(new URL('http://203.0.113.7'), Date.now() + 1000);
    const now = Date.now();

    jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(store.get()).toBeUndefined();
  });

  it('keeps the target in its file, for the next start', async () => {
    const store = createTargetStore({ logger, persistPath });
    const set = store.set(new URL('http://203.0.113.7:8080'), Date.now() + 60000);
    await store.saved();

    expect(createTargetStore({ logger, persistPath }).get()).toMatchObject({ url: set.url, setAt: set.setAt, expiresAt: set.expiresAt });
  });

  it('removes the file with the target', async () => {
    const store = createTargetStore({ logger, persistPath });
    store.set(new URL('http://203.0.113.7:8080'));
    store.unset();
    await store.saved();

    expect(existsSync(persistPath)).toBe(false);
  });

  it('takes over the target of the server it replaces, with connections of its own, over the one in its file', async () => {
    writeFileSync(persistPath, JSON.stringify({ target: 'http://203.0.113.9/', setAt: 1 }));
    const seed = createTargetStore({ logger }).set(new URL('http://203.0.113.7:8080'), Date.now() + 60000);

    const store = createTargetStore({ logger, persistPath }, seed);
    await store.saved();

    expect(store.get()).toMatchObject({ url: seed.url, setAt: seed.setAt, expiresAt: seed.expiresAt });
    expect(store.get()?.agent).not.toBe(seed.agent);
    expect(JSON.parse(readFileSync(persistPath, 'utf8'))).toMatchObject({ target: 'http://203.0.113.7:8080/' });
  });

  it('does not take over a target that expired', () => {
    const seed = createTargetStore({ logger }).set(new URL('http://203.0.113.7:8080'), Date.now() - 1);

    expect(createTargetStore({ logger }, seed).get()).toBeUndefined();
  });

  it('closes the connections to its target once they are idle when it is closed', async () => {
    const upstream = http.createServer((request, response) => response.end('ok'));
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    const store = createTargetStore({ logger });
    const { agent, url } = store.set(new URL(`http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`));
    const response = await new Promise<http.IncomingMessage>((resolve) => http.get(url, { agent }, resolve));
    response.resume();
    const [socket] = await once(agent, 'free');

    try {
      store.close();

      expect(socket.destroyed).toBe(true);
    } finally {
      upstream.closeAllConnections();
      upstream.close();
    }
  });

  it('does not restore a target that expired while the server was down', () => {
    writeFileSync(persistPath, JSON.stringify({ target: 'http://203.0.113.7/', setAt: 1, expiresAt: Date.now() - 1 }));

    expect(createTargetStore({ logger, persistPath }).get()).toBeUndefined();
  });

  it.each(['not json', JSON.stringify({ target: 1, setAt: 1 }), JSON.stringify({ target: 'not a url', setAt: 1 })])(
    'starts without a target from %s',
    (content) => {
      writeFileSync(persistPath, content);

      expect(createTargetStore({ logger, persistPath }).get()).toBeUndefined();
      expect(readFileSync(persistPath, 'utf8')).toBe(content);
    }
  );

  describe('in a front', () => {
    const unsubscribe = jest.fn();
    const targets = { get: jest.fn(), publish: jest.fn(async () => undefined), subscribe: jest.fn(() => unsubscribe) };
    const shared = { targets, key: 'https a' };
    const told = () => jest.mocked(targets.subscribe).mock.calls[0] as unknown as [string, (change: object) => void];

    beforeEach(() => {
      jest.clearAllMocks();
      targets.get.mockReturnValue(undefined);
    });

    it('tells the other fronts what is registered, and leaves the file to the primary', async () => {
      const store = createTargetStore({ logger, persistPath, shared });

      const set = store.set(new URL('http://203.0.113.7:8080'), Date.now() + 60000);
      await store.published();
      store.unset();

      expect(targets.publish.mock.calls).toEqual([
        [{ key: 'https a', persistPath, target: set.url.href, setAt: set.setAt, expiresAt: set.expiresAt }],
        [{ key: 'https a', persistPath, setAt: expect.any(Number) }],
      ]);
      await store.saved();
      expect(existsSync(persistPath)).toBe(false);
    });

    it('takes what the other fronts registered, keeping the connections to the same target, and forgets what they removed', () => {
      const store = createTargetStore({ logger, shared });
      const [key, listener] = told();

      listener({ key, target: 'http://203.0.113.7:8080/', setAt: 1 });
      const first = store.get();
      listener({ key, target: 'http://203.0.113.7:8080/', setAt: 2 });
      expect(store.get()).toMatchObject({ setAt: 2, agent: first?.agent });
      listener({ key, setAt: 3 });

      expect(key).toBe('https a');
      expect(store.get()).toBeUndefined();
    });

    it('starts with what the fronts have, over the file and the server it replaces', () => {
      writeFileSync(persistPath, JSON.stringify({ target: 'http://203.0.113.9/', setAt: 1 }));
      targets.get.mockReturnValue({ key: 'https a', target: 'http://203.0.113.8/', setAt: 2 });

      expect(createTargetStore({ logger, persistPath, shared }).get()?.url.href).toBe('http://203.0.113.8/');
    });

    it('does not bring back from the file what the fronts removed, and has nothing to tell then', () => {
      writeFileSync(persistPath, JSON.stringify({ target: 'http://203.0.113.9/', setAt: 1 }));
      targets.get.mockReturnValue({ key: 'https a', setAt: 2 });
      const seed = createTargetStore({ logger }).set(new URL('http://203.0.113.7'));

      expect(createTargetStore({ logger, persistPath, shared }, seed).get()).toBeUndefined();
      expect(targets.publish).not.toHaveBeenCalled();
    });

    it('stops listening once it is closed', () => {
      createTargetStore({ logger, shared }).close();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
