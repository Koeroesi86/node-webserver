import cluster from 'cluster';
import os from 'os';
import startPrimary from './start-primary';
import {
  connectLauncher,
  createFrontSet,
  createAppRegistry,
  createFrontsManager,
  createPrimaryCertificates,
  readServerVersion,
  watchRelease,
} from '../cluster';
import { getLauncherMode } from '../launcher';
import { setupPrimaryHooks } from '../lifecycle';
import { watchFiles } from '../reload';
import createMockLogger from '../observability/mock-logger.test-helper';
import { FRONT_STOP_MARGIN, RESTART_EXIT_CODE } from '../constants';

jest.mock('cluster', () => ({ __esModule: true, default: { isWorker: false, SCHED_RR: 2, SCHED_NONE: 1, schedulingPolicy: 0 } }));
jest.mock('../cluster', () => ({
  ...jest.requireActual('../cluster'),
  connectLauncher: jest.fn(),
  createFrontSet: jest.fn(),
  createFrontsManager: jest.fn(),
  createPrimaryCertificates: jest.fn(),
  createAppRegistry: jest.fn(),
  watchRelease: jest.fn(),
}));
jest.mock('../launcher', () => ({ getLauncherMode: jest.fn() }));
jest.mock('../lifecycle', () => ({ ...jest.requireActual('../lifecycle'), setupPrimaryHooks: jest.fn() }));

describe('startPrimary', () => {
  const logger = createMockLogger();
  const manager = { start: jest.fn(), stop: jest.fn(), reload: jest.fn(), reloadFronts: jest.fn(), check: jest.fn(), getPlan: jest.fn() };
  const certificates = { service: { join: jest.fn() }, start: jest.fn(), stop: jest.fn() };
  const apps = { join: jest.fn(), stop: jest.fn() };
  const unwatchRelease = jest.fn();
  const launcher = { signals: {} as never, serving: jest.fn(async () => undefined) };
  const removeHooks = jest.fn();
  const configuration = { frontProcesses: 2, servers: [], portHttp: 0, portHttps: 0, shutdownTimeout: 100 };
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform') ?? {};
  let exit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(os, 'availableParallelism').mockReturnValue(8);
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    manager.start.mockResolvedValue(undefined);
    manager.stop.mockResolvedValue(undefined);
    manager.getPlan.mockReturnValue(undefined);
    jest.mocked(createFrontsManager).mockReturnValue(manager);
    jest.mocked(createPrimaryCertificates).mockReturnValue(certificates as never);
    jest.mocked(createAppRegistry).mockReturnValue(apps);
    jest.mocked(watchRelease).mockReturnValue(unwatchRelease);
    jest.mocked(setupPrimaryHooks).mockReturnValue(removeHooks);
    jest.mocked(connectLauncher).mockReturnValue(launcher);
    jest.mocked(getLauncherMode).mockReturnValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  const options = () => jest.mocked(createFrontsManager).mock.calls[0][0];
  const hooks = () => jest.mocked(setupPrimaryHooks).mock.calls[0][1];

  it.each<[number, NodeJS.Platform, number]>([
    [1, 'linux', cluster.SCHED_NONE],
    [2, 'linux', cluster.SCHED_RR],
    [1, 'win32', cluster.SCHED_RR],
  ])('with frontProcesses %i on %s has the connections accepted by the ones that serve, or in turn', async (frontProcesses, platform, policy) => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });

    await startPrimary({ ...configuration, frontProcesses }, logger, {});

    expect(cluster.schedulingPolicy).toBe(policy);
  });

  it('starts the fronts of the configuration and its limits', async () => {
    const running = await startPrimary({ ...configuration, frontProcesses: 4, workerLimit: 3 }, logger, {});

    expect(manager.start).toHaveBeenCalledWith(expect.objectContaining({ frontCount: 3, balanced: true }));
    expect(options().version).toBe(readServerVersion());
    expect(running).toMatchObject({ role: 'primary', frontCount: 3, removeProcessHooks: removeHooks });
  });

  it('says the number of fronts that serve now', async () => {
    const running = await startPrimary(configuration, logger, {});
    manager.getPlan.mockReturnValue({ frontCount: 4 });

    expect(running.frontCount).toBe(4);
  });

  it('makes the sets of fronts that watch the files of their servers', async () => {
    await startPrimary(configuration, logger, {});
    const events = { onStale: jest.fn(), onRecount: jest.fn() };

    options().createSet({ frontCount: 2 } as never, events);

    expect(createFrontSet).toHaveBeenCalledWith(
      expect.objectContaining({ plan: { frontCount: 2 }, services: expect.any(Object), watch: watchFiles, ...events })
    );
    expect(options().watch).toBe(watchFiles);
  });

  it('says what is wrong with the configuration before a front is started', async () => {
    const worker = { hostname: 'worker.localhost', protocol: 'http', type: 'worker' as const };

    await expect(startPrimary({ ...configuration, servers: [worker] }, logger, {})).rejects.toThrow('options');
    expect(createFrontsManager).not.toHaveBeenCalled();
  });

  it('stops what runs, takes its listeners off and rejects when the fronts do not start', async () => {
    manager.start.mockRejectedValue(new Error('Front 1 did not start'));

    await expect(startPrimary(configuration, logger, {})).rejects.toThrow('Front 1 did not start');
    expect(manager.stop).toHaveBeenCalled();
    expect(removeHooks).toHaveBeenCalled();
  });

  it('reloads and stops through the manager, with the settings of the configuration that runs', async () => {
    const running = await startPrimary(configuration, logger, {});
    expect(hooks().settings()).toMatchObject({ shutdownTimeout: 100 });
    manager.getPlan.mockReturnValue({ settings: { shutdownTimeout: 7 } });

    running.reload();
    await running.stop();

    expect(manager.reload).toHaveBeenCalled();
    expect(manager.stop).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, 7 + FRONT_STOP_MARGIN);
  });

  it('orders the certificates once the fronts serve, until it stops, and has all fronts load what it got', async () => {
    const running = await startPrimary(configuration, logger, {});

    expect(certificates.start.mock.invocationCallOrder[0]).toBeGreaterThan(manager.start.mock.invocationCallOrder[0]);
    jest.mocked(createPrimaryCertificates).mock.calls[0][0].reload();
    expect(manager.reloadFronts).toHaveBeenCalled();

    await hooks().stop({ nodeWebserver: 'stop' }, 1);
    await running.stop();
    expect(certificates.stop).toHaveBeenCalledTimes(2);
  });

  it('ends the applications once the fronts stopped, and when it ends for a restart', async () => {
    jest.mocked(getLauncherMode).mockReturnValue('start');
    const running = await startPrimary(configuration, logger, {});

    await running.stop();
    expect(apps.stop.mock.invocationCallOrder[0]).toBeGreaterThan(manager.stop.mock.invocationCallOrder[0]);
    options().restart?.();
    options().onLost();

    expect(apps.stop).toHaveBeenCalledTimes(3);
  });

  it('looks for another installed version when it was launched, until it stops, and applies it unless watching is off', async () => {
    jest.mocked(getLauncherMode).mockReturnValue('start');
    const running = await startPrimary(configuration, logger, {});
    const { running: version, read, onChange } = jest.mocked(watchRelease).mock.calls[0][0];

    expect([version, read]).toEqual([readServerVersion(), readServerVersion]);
    onChange();
    expect(manager.check).toHaveBeenCalledTimes(1);
    manager.getPlan.mockReturnValue({ settings: { watchServers: false, shutdownTimeout: 1 } });
    onChange();
    expect(manager.check).toHaveBeenCalledTimes(1);

    await running.stop();
    expect(unwatchRelease).toHaveBeenCalled();
  });

  it('does not look for another version without a launcher, which could not start it', async () => {
    await startPrimary(configuration, logger, {});

    expect(watchRelease).not.toHaveBeenCalled();
  });

  it('cannot restart without a launcher', async () => {
    await startPrimary(configuration, logger, {});

    expect(options().restart).toBeUndefined();
    expect(connectLauncher).not.toHaveBeenCalled();
  });

  it('takes the signals of its launcher, tells it that it serves, and ends for a restart with the exit code for that', async () => {
    jest.mocked(getLauncherMode).mockReturnValue('start');

    await startPrimary(configuration, logger, {});
    options().restart?.();

    expect(hooks().signals).toBe(launcher.signals);
    expect(launcher.serving).toHaveBeenCalled();
    expect(logger.flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('fails once no front is left, and ends the process when its hooks are on (%s)', async (processHooks, exits) => {
    await startPrimary(configuration, logger, { processHooks });

    options().onLost();

    expect(process.exitCode).toBe(1);
    expect(exit).toHaveBeenCalledTimes(exits);
  });
});
