import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import createTargetRegistry from './create-target-registry';
import createMockLogger from '../observability/mock-logger.test-helper';

describe('createTargetRegistry', () => {
  const logger = createMockLogger();
  const change = { key: 'https a', target: 'http://203.0.113.7/', setAt: 2 };

  const until = async (condition: () => boolean) => {
    while (!condition()) await new Promise((resolve) => setImmediate(resolve));
  };

  /** two fronts that listen */
  const joinTwo = () => {
    const registry = createTargetRegistry(logger);
    const sends = [jest.fn(), jest.fn()];
    const members = sends.map((send) => registry.join(send));
    members.forEach((member) => member.hello());
    sends.forEach((send) => send.mockClear());
    return { registry, sends, members };
  };

  it('tells every front what was registered with one of them, and a front that comes later too', () => {
    const { registry, sends, members } = joinTwo();

    members[0].change(change);
    const late = jest.fn();
    const member = registry.join(late);
    members[0].change(change);
    expect(late).not.toHaveBeenCalled();
    member.hello();

    const told = [{ nodeWebserver: 'targets', changes: [change] }];
    expect(sends.map((send) => send.mock.lastCall)).toEqual([told, told]);
    expect(late.mock.calls).toEqual([told]);
  });

  it('keeps what is newer than a change, and tells that', () => {
    const { sends, members } = joinTwo();
    members[0].change(change);

    members[1].change({ ...change, target: 'http://203.0.113.8/', setAt: 1 });

    expect(sends[1]).toHaveBeenLastCalledWith({ nodeWebserver: 'targets', changes: [change] });
  });

  it('says nothing of a front that left', () => {
    const { sends, members } = joinTwo();

    members[1].leave();
    members[0].change(change);

    expect(sends[1]).not.toHaveBeenCalled();
  });

  it('forgets the target of a server once no front has it, but not before every front said what it has', () => {
    const { sends, members } = joinTwo();
    members[0].change(change);

    members[0].holds([]);
    members[0].hello();
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'targets', changes: [change] });

    members[1].holds(['https a']);
    members[0].hello();
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'targets', changes: [change] });

    members[1].holds([]);
    members[0].hello();
    expect(sends[0]).toHaveBeenLastCalledWith({ nodeWebserver: 'targets', changes: [] });
  });

  it('writes the file of a target, also to the one it is given later', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'target-registry-'));
    const [first, second] = [join(folder, 'first.json'), join(folder, 'second.json')];
    const { members } = joinTwo();

    members[0].change({ ...change, persistPath: first });
    members[1].change({ ...change, persistPath: second });

    const written = () => [first, second].map((path) => JSON.parse(readFileSync(path, 'utf8')));
    // the file is written some time after the change, and is empty or missing until then
    await until(() => [first, second].every((path) => existsSync(path) && readFileSync(path, 'utf8').endsWith('}')));
    expect(written()).toEqual([
      { target: change.target, setAt: 2 },
      { target: change.target, setAt: 2 },
    ]);
    rmSync(folder, { recursive: true, force: true });
  });
});
