import startCluster from './start-cluster';
import createServer from './create-server';
import startFront from './start-front';
import startPrimary from './start-primary';
import { getFrontProcess } from '../cluster';
import createMockLogger from '../observability/mock-logger.test-helper';

jest.mock('./create-server', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./start-front', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./start-primary', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../cluster', () => ({ ...jest.requireActual('../cluster'), getFrontProcess: jest.fn() }));

describe('startCluster', () => {
  const logger = createMockLogger();
  const running = { reload: jest.fn(), stop: jest.fn(), removeProcessHooks: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createServer).mockResolvedValue(running as never);
    // the cores decide how many fronts can be asked for
    jest.spyOn(require('os'), 'availableParallelism').mockReturnValue(8);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([[{}], [{ frontProcesses: 1 }]])('starts a server in this process for %j', async (configuration) => {
    const cluster = await startCluster(configuration, logger);

    expect(createServer).toHaveBeenCalledWith(configuration, logger, { processHooks: undefined, stoppable: true });
    expect(cluster).toEqual({ role: 'single', frontCount: 1, ...running });
    expect(startPrimary).not.toHaveBeenCalled();
  });

  it('starts a server in this process for auto on a single core', async () => {
    jest.mocked(require('os').availableParallelism).mockReturnValue(1);

    await startCluster({ frontProcesses: 'auto' }, logger);

    expect(createServer).toHaveBeenCalled();
    expect(startPrimary).not.toHaveBeenCalled();
  });

  it('starts the primary for several fronts, also when a limit brings them down to one', async () => {
    const configuration = { frontProcesses: 2, workerLimit: 1 };

    await startCluster(configuration, logger, { processHooks: false });

    expect(startPrimary).toHaveBeenCalledWith(configuration, logger, { processHooks: false });
    expect(createServer).not.toHaveBeenCalled();
  });

  it('starts the front in a process that the primary started', async () => {
    jest.mocked(getFrontProcess).mockReturnValue({ index: 1, count: 2 });

    await startCluster({ frontProcesses: 2 }, logger);

    expect(startFront).toHaveBeenCalledWith({ index: 1, count: 2 }, { frontProcesses: 2 }, logger, {});
    expect(startPrimary).not.toHaveBeenCalled();
  });
});
