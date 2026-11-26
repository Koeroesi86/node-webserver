import cluster from 'cluster';
import os from 'os';
import startPrimary from './start-primary';
import { createFrontSupervisor, readServerVersion } from '../cluster';
import { setupPrimaryHooks } from '../lifecycle';
import createMockLogger from '../observability/mock-logger.test-helper';
import { FRONT_STOP_MARGIN } from '../constants';

jest.mock('cluster', () => ({ __esModule: true, default: { isWorker: false, SCHED_RR: 2, schedulingPolicy: 1 } }));
jest.mock('../cluster', () => ({ ...jest.requireActual('../cluster'), createFrontSupervisor: jest.fn() }));
jest.mock('../lifecycle', () => ({ ...jest.requireActual('../lifecycle'), setupPrimaryHooks: jest.fn() }));

describe('startPrimary', () => {
  const logger = createMockLogger();
  const supervisor = { start: jest.fn(), send: jest.fn(), stop: jest.fn() };
  const removeHooks = jest.fn();
  const configuration = { frontProcesses: 2, servers: [], portHttp: 0, portHttps: 0, shutdownTimeout: 100 };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(os, 'availableParallelism').mockReturnValue(8);
    supervisor.start.mockResolvedValue(undefined);
    jest.mocked(createFrontSupervisor).mockReturnValue(supervisor);
    jest.mocked(setupPrimaryHooks).mockReturnValue(removeHooks);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  const options = () => jest.mocked(createFrontSupervisor).mock.calls[0][0];

  it('has the connections handed to the fronts in turn, and starts as many as the configuration and its limits say', async () => {
    const running = await startPrimary({ ...configuration, frontProcesses: 4, workerLimit: 3 }, logger, {});

    expect(cluster.schedulingPolicy).toBe(cluster.SCHED_RR);
    expect(options()).toMatchObject({ count: 3, release: { version: readServerVersion() } });
    expect(running).toMatchObject({ role: 'primary', frontCount: 3, removeProcessHooks: removeHooks });
  });

  it('says what is wrong with the configuration before a front is started', async () => {
    const child = { hostname: 'child.localhost', protocol: 'http', type: 'child' as const, childOptions: { command: 'node', args: ['%PORT%'] } };

    await expect(
      startPrimary({ ...configuration, servers: [{ ...child, proxyOptions: {}, serverOptions: { protocol: 'http' } }] }, logger, {})
    ).rejects.toThrow('a child server works with one front process only');
    expect(createFrontSupervisor).not.toHaveBeenCalled();
  });

  it('takes its listeners off and rejects when the fronts do not start', async () => {
    supervisor.start.mockRejectedValue(new Error('Front 1 did not start'));

    await expect(startPrimary(configuration, logger, {})).rejects.toThrow('Front 1 did not start');
    expect(removeHooks).toHaveBeenCalled();
  });

  it('reloads and stops every front', async () => {
    const running = await startPrimary(configuration, logger, {});

    running.reload();
    await running.stop();

    expect(supervisor.send).toHaveBeenCalledWith({ nodeWebserver: 'reload' });
    expect(supervisor.stop).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, 100 + FRONT_STOP_MARGIN);
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('fails once no front is left, and ends the process when its hooks are on (%s)', async (processHooks, exits) => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await startPrimary(configuration, logger, { processHooks });

    options().onLost();

    expect(process.exitCode).toBe(1);
    expect(logger.flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(exits);
  });
});
