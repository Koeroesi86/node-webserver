import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CLI, createServerFolder, isAlive, until } from './helpers/server-folder';
import type { ServerFolder } from './helpers/server-folder';

// it installs a service on the machine and needs root (sudo without a password) or an administrator, so it only runs where that is asked for, which the pipeline does
const describeService = process.env.SERVICE_INTEGRATION === '1' ? describe : describe.skip;
const serviceName = 'nws-cli-integration';

describeService('an installed service', () => {
  let folder: ServerFolder;
  let logs: string;

  const service = (action: 'add' | 'remove') => {
    const command = [process.execPath, CLI, 'service', action, '--config', folder.configurationFile];
    const [file, ...args] = process.platform === 'win32' ? command : ['sudo', '-n', ...command];

    return spawnSync(file, args, { encoding: 'utf8' });
  };

  /** what the server wrote to its log files, and to the journal where there is one */
  const describeFailure = () => {
    const files = fs.readdirSync(logs).map((name) => `${name}:\n${fs.readFileSync(path.join(logs, name), 'utf8')}`);
    const journal = process.platform === 'linux' ? spawnSync('sudo', ['-n', 'journalctl', '-u', serviceName, '-n', '50'], { encoding: 'utf8' }).stdout : '';

    return `The logs of the service:\n${[...files, journal].join('\n')}`;
  };

  const configure = (hosts: string[] = []) =>
    folder.configure(
      { serviceName, fileLogPath: logs },
      hosts.map((hostname) => folder.server(hostname))
    );

  beforeAll(async () => {
    folder = await createServerFolder();
    logs = path.join(folder.folder, 'logs');
    // made here, so that the files the service writes can be removed
    fs.mkdirSync(logs);
  });

  afterAll(() => {
    service('remove');
    folder.remove();
  });

  it('serves, picks up a change of its configuration, and leaves no process behind when it is removed', async () => {
    // one that a run before left behind
    service('remove');
    configure();
    const added = service('add');
    expect([added.status, added.stderr]).toEqual([0, expect.any(String)]);
    await until(async () => (await folder.get()).status === 200, describeFailure);

    configure(['added.localhost']);
    await until(async () => (await folder.get('added.localhost')).status === 200, describeFailure);
    const { worker } = await folder.get();
    const processes = [...folder.processes(), worker ?? 0].filter((pid) => pid && isAlive(pid));

    const removed = service('remove');

    expect([removed.status, removed.stderr]).toEqual([0, expect.any(String)]);
    await until(() => !processes.some(isAlive), describeFailure);
    await until(async () => (await folder.get()).status === 0, describeFailure);
  });
});
