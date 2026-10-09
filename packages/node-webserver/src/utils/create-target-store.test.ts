import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import createTargetStore from './create-target-store';

jest.mock('./logger', () => ({ __esModule: true, default: { error: jest.fn(), warning: jest.fn() } }));

describe('createTargetStore', () => {
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
    const store = createTargetStore({});
    const first = store.set(new URL('http://203.0.113.7:8080'));
    const again = store.set(new URL('http://203.0.113.7:8080'));
    const other = store.set(new URL('http://203.0.113.8:8080'));

    expect(again.agent).toBe(first.agent);
    expect(other.agent).not.toBe(first.agent);
    expect(store.get()).toBe(other);
  });

  it('forgets a target once it expired', () => {
    const store = createTargetStore({});
    store.set(new URL('http://203.0.113.7'), Date.now() + 1000);
    const now = Date.now();

    jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(store.get()).toBeUndefined();
  });

  it('keeps the target in its file, for the next start', async () => {
    const store = createTargetStore({ persistPath });
    const set = store.set(new URL('http://203.0.113.7:8080'), Date.now() + 60000);
    await store.saved();

    expect(createTargetStore({ persistPath }).get()).toMatchObject({ url: set.url, setAt: set.setAt, expiresAt: set.expiresAt });
  });

  it('removes the file with the target', async () => {
    const store = createTargetStore({ persistPath });
    store.set(new URL('http://203.0.113.7:8080'));
    store.unset();
    await store.saved();

    expect(existsSync(persistPath)).toBe(false);
  });

  it('does not restore a target that expired while the server was down', () => {
    writeFileSync(persistPath, JSON.stringify({ target: 'http://203.0.113.7/', setAt: 1, expiresAt: Date.now() - 1 }));

    expect(createTargetStore({ persistPath }).get()).toBeUndefined();
  });

  it.each(['not json', JSON.stringify({ target: 1, setAt: 1 }), JSON.stringify({ target: 'not a url', setAt: 1 })])(
    'starts without a target from %s',
    (content) => {
      writeFileSync(persistPath, content);

      expect(createTargetStore({ persistPath }).get()).toBeUndefined();
      expect(readFileSync(persistPath, 'utf8')).toBe(content);
    }
  );
});
