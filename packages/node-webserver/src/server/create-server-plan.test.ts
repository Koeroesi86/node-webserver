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
      singleFrontOnly: false,
      release: { version: readServerVersion() },
      files: [],
      settings: { reloadOnSighup: true, shutdownTimeout: 7, watchServers: true },
    });
    expect(plan.filesFingerprint).toBeUndefined();
  });

  it('has the primary accept only for several fronts, also when a limit brings them down to one', () => {
    const balanced = [{}, { frontProcesses: 4, workerLimit: 1 }].map((configuration) => createServerPlan({ servers: [], ...configuration }).balanced);

    expect(balanced).toEqual([false, true]);
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
