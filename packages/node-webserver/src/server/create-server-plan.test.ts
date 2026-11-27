import fs from 'fs';
import os from 'os';
import path from 'path';
import createServerPlan from './create-server-plan';
import { readServerVersion } from '../cluster';

describe('createServerPlan', () => {
  beforeEach(() => jest.spyOn(os, 'availableParallelism').mockReturnValue(8));
  afterEach(() => jest.restoreAllMocks());

  it('says what the server of a configuration would be', () => {
    const plan = createServerPlan({ frontProcesses: 3, servers: [], reloadOnSighup: true, shutdownTimeout: 7 });

    expect(plan).toMatchObject({
      problems: [],
      frontCount: 3,
      balanced: true,
      release: { version: readServerVersion() },
      files: [],
      settings: { reloadOnSighup: true, shutdownTimeout: 7, watchServers: true },
    });
    expect(plan.filesFingerprint).toBeUndefined();
  });

  it.each<[string, NodeJS.Platform, boolean[]]>([
    ['only for several fronts, also when a limit brings them down to one', 'linux', [false, true]],
    ['for one front too on Windows, where a front that stops listening would take a connection with it', 'win32', [true, true]],
  ])('has the primary accept %s', (_, platform, expected) => {
    const configurations = [{ frontProcesses: 1 }, { frontProcesses: 4, workerLimit: 1 }];

    const balanced = configurations.map((configuration) => createServerPlan({ servers: [], ...configuration }, undefined, platform).balanced);

    expect(balanced).toEqual(expected);
  });

  it('runs as many fronts as the cores allow without the setting, with the primary accepting', () => {
    expect(createServerPlan({ servers: [] }, undefined, 'linux')).toMatchObject({ frontCount: 4, balanced: true });
  });

  it('fingerprints the files of the configuration', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'server-plan-'));
    const file = path.join(folder, 'configuration.js');
    fs.writeFileSync(file, 'one');
    const first = createServerPlan({ servers: [] }, file);

    fs.writeFileSync(file, 'two');

    expect(first.files).toEqual([file]);
    expect(createServerPlan({ servers: [] }, file).filesFingerprint).not.toBe(first.filesFingerprint);
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
