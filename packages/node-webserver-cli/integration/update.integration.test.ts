import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createServerFolder, isAlive, until } from './helpers/server-folder';
import type { ServerFolder } from './helpers/server-folder';

const CLI_PACKAGE = path.resolve(__dirname, '..');
const SERVER_PACKAGE = path.resolve(__dirname, '../../node-webserver');

describe('an update of the installed server', () => {
  let folder: ServerFolder;
  let launcher: ChildProcess;
  let output = '';

  const installed = (release: string, name: string) => path.join(folder.folder, 'releases', release, 'node_modules', '@koeroesi86', name);
  const current = () => path.join(folder.folder, 'current');

  const setVersion = (server: string, version: string) => {
    const file = path.join(server, 'package.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), version }));
  };

  const copy = (source: string, target: string) => {
    fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
  };

  /** every dependency of the server linked on its own, as the links in a linked `node_modules` are not found through it on Windows */
  const linkDependencies = (server: string) => {
    const { dependencies }: { dependencies: Record<string, string> } = JSON.parse(fs.readFileSync(path.join(SERVER_PACKAGE, 'package.json'), 'utf8'));
    Object.keys(dependencies).forEach((name) => {
      const dependency = path.join(server, 'node_modules', name);
      fs.mkdirSync(path.dirname(dependency), { recursive: true });
      fs.symlinkSync(fs.realpathSync(path.join(SERVER_PACKAGE, 'node_modules', name)), dependency, 'junction');
    });
  };

  /** copies of the command line and the server, which find what they depend on where the ones of the repository do */
  const copyPackages = (cli: string, server: string, version: string) => {
    copy(CLI_PACKAGE, cli);
    copy(SERVER_PACKAGE, server);
    fs.copyFileSync(path.join(SERVER_PACKAGE, 'configuration.schema.json'), path.join(server, 'configuration.schema.json'));
    linkDependencies(server);
    setVersion(server, version);
  };

  /** a release in a folder of its own */
  const install = (release: string, version: string) => copyPackages(installed(release, 'node-webserver-cli'), installed(release, 'node-webserver'), version);

  /** makes the link lead to the folder, as every deploy and every update of a package manager does */
  const link = (from: string, to: string) => {
    if (fs.existsSync(from)) fs.unlinkSync(from);
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.symlinkSync(to, from, 'junction');
  };

  const point = (release: string) => link(current(), path.join(folder.folder, 'releases', release));

  /** a version in the store of a project of pnpm, which the link of the project to the command line leads to then. Returns the script in the store. */
  const installInStore = (version: string) => {
    const modules = path.join(folder.folder, 'node_modules');
    const stored = (name: string) => path.join(modules, '.pnpm', `${name}@${version}`, 'node_modules', '@koeroesi86');
    const cli = path.join(stored('node-webserver-cli'), 'node-webserver-cli');
    const server = path.join(stored('node-webserver'), 'node-webserver');
    copyPackages(cli, server, version);
    link(path.join(stored('node-webserver-cli'), 'node-webserver'), server);
    link(path.join(modules, '@koeroesi86', 'node-webserver-cli'), cli);

    return path.join(cli, 'dist', 'scripts', 'cli.js');
  };

  /** runs the command by that path, and waits until it serves */
  const launch = async (script: string) => {
    folder.configure();
    launcher = spawn(process.execPath, [script, '--config', folder.configurationFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    launcher.stdout?.on('data', (data: Buffer) => (output += data));
    launcher.stderr?.on('data', (data: Buffer) => (output += data));
    await eventually(async () => (await front()) > 0);

    return front();
  };

  const describeFailure = () => `The output of the server:\n${output}`;
  const eventually = (condition: () => Promise<boolean> | boolean) => until(condition, describeFailure, 60000);
  const restarts = () => output.split('[launcher] Starting the server again').length - 1;
  const front = async () => (await folder.get()).front ?? 0;
  /** waits until the server was started again that often and serves, and tells its front */
  const restarted = async (times: number) => {
    await eventually(async () => restarts() === times && (await front()) > 0);
    return front();
  };

  beforeEach(async () => {
    output = '';
    folder = await createServerFolder();
  });

  afterEach(async () => {
    const pids = [launcher.pid ?? 0, ...folder.processes()];
    // one that ended already, as after a failed start, has no exit left to wait for
    const ended = () => launcher.exitCode !== null || launcher.signalCode !== null;
    const exited = new Promise((resolve) => (ended() ? resolve(undefined) : launcher.once('exit', resolve)));
    // the launcher takes everything it started with it
    launcher.kill('SIGKILL');
    await exited;
    await until(() => !pids.some(isAlive), describeFailure);
    folder.remove();
  });

  it('restarts into a new version once it starts with the configuration, and keeps the old one running while it does not', async () => {
    install('one', '1.0.0');
    point('one');
    const first = await launch(path.join(current(), 'node_modules', '@koeroesi86', 'node-webserver-cli', 'dist', 'scripts', 'cli.js'));

    install('broken', '2.0.0');
    fs.rmSync(path.join(installed('broken', 'node-webserver'), 'dist', 'server', 'start-plan.js'));
    point('broken');
    await eventually(() => output.includes('could not be loaded'));
    expect([await front(), restarts()]).toEqual([first, 0]);

    install('three', '3.0.0');
    point('three');
    const third = await restarted(1);
    expect(third).not.toBe(first);
    expect(output).toContain('version of the installed server changed: @koeroesi86/node-webserver@3.0.0 now, instead of @koeroesi86/node-webserver@1.0.0');

    // in place, as some package managers write it
    setVersion(installed('three', 'node-webserver'), '4.0.0');
    expect(await restarted(2)).not.toBe(third);
  }, 240000);

  it('restarts into an update of a project of pnpm, whose command runs the file in the store', async () => {
    const first = await launch(installInStore('1.0.0'));

    installInStore('2.0.0');

    expect(await restarted(1)).not.toBe(first);
    expect(output).toContain('@koeroesi86/node-webserver@2.0.0 now, instead of @koeroesi86/node-webserver@1.0.0');
  }, 120000);
});
