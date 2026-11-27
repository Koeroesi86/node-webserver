import startCluster from './start-cluster';
import startFront from './start-front';
import startPlan from './start-plan';
import startPrimary from './start-primary';
import { getFrontProcess } from '../launcher';
import createMockLogger from '../observability/mock-logger.test-helper';

jest.mock('./start-front', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./start-plan', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./start-primary', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../launcher', () => ({ ...jest.requireActual('../launcher'), getFrontProcess: jest.fn() }));

describe('startCluster', () => {
  const logger = createMockLogger();

  beforeEach(() => jest.clearAllMocks());

  it.each([[{}], [{ frontProcesses: 2 }]])('starts a primary for %j', async (configuration) => {
    await startCluster(configuration, logger, { processHooks: false });

    expect(startPrimary).toHaveBeenCalledWith(configuration, logger, { processHooks: false });
    expect(startFront).not.toHaveBeenCalled();
  });

  it('starts the front in a process that the primary started', async () => {
    jest.mocked(getFrontProcess).mockReturnValue({ index: 1, count: 2 });

    await startCluster({ frontProcesses: 2 }, logger);

    expect(startFront).toHaveBeenCalledWith({ index: 1, count: 2 }, { frontProcesses: 2 }, logger, {});
    expect(startPrimary).not.toHaveBeenCalled();
  });

  it('only looks at the configuration in a process that the primary started for that', async () => {
    jest.mocked(getFrontProcess).mockReturnValue({ index: 0, count: 1, plan: true });

    await startCluster({}, logger, { configurationFile: '/configuration.js' });

    expect(startPlan).toHaveBeenCalledWith({}, '/configuration.js');
    expect(startFront).not.toHaveBeenCalled();
    expect(startPrimary).not.toHaveBeenCalled();
  });
});
