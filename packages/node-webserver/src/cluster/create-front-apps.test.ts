import createFrontApps from './create-front-apps';

describe('createFrontApps', () => {
  it('asks the primary once for an application that several servers want, and releases it once none does', async () => {
    const send = jest.fn();
    const apps = createFrontApps(send);

    const ports = [apps.claim('a', { port: 8080 }), apps.claim('a', { port: 8080 })];
    apps.receive({ key: 'a', port: 8080 });
    apps.start('a', 'node', ['app.js']);
    apps.release('a');
    apps.release('a');
    apps.release('a');

    expect(await Promise.all(ports)).toEqual([8080, 8080]);
    expect(send.mock.calls).toEqual([
      [{ nodeWebserver: 'app-claim', key: 'a', port: 8080, lookup: undefined }],
      [{ nodeWebserver: 'app-start', key: 'a', command: 'node', args: ['app.js'] }],
      [{ nodeWebserver: 'app-release', key: 'a' }],
    ]);
  });

  it('asks again for one that was released', () => {
    const send = jest.fn();
    const apps = createFrontApps(send);

    void apps.claim('a', {});
    apps.release('a');
    void apps.claim('a', {});

    expect(send.mock.calls.map(([{ nodeWebserver }]) => nodeWebserver)).toEqual(['app-claim', 'app-release', 'app-claim']);
  });

  it('ends the applications the primary said run last, also when one of them is gone', () => {
    const kill = jest.fn(() => {
      throw new Error('no such process');
    });
    const apps = createFrontApps(jest.fn(), kill);

    apps.runs([{ key: 'a', pid: 1 }]);
    apps.runs([
      { key: 'b', pid: 2 },
      { key: 'c', pid: 3 },
    ]);
    expect([apps.pid('a'), apps.pid('b')]).toEqual([undefined, 2]);
    apps.endAll();

    expect(kill.mock.calls).toEqual([[2], [3]]);
  });

  it('rejects with what the primary said when there is no port, and ignores what nothing waits for', async () => {
    const apps = createFrontApps(jest.fn());
    const port = apps.claim('a', {});

    apps.receive({ key: 'b', port: 1 });
    apps.receive({ key: 'a', error: 'No more available port left.' });

    await expect(port).rejects.toThrow('No more available port left.');
  });
});
