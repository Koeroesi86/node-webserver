const mockLoaded: string[] = [];
const mockServer = { startServer: jest.fn(async () => 'server'), startCluster: jest.fn(async () => 'cluster') };
const mockConfiguration = { checkConfiguration: jest.fn(() => ['problem']) };
const mockProblems = { formatProblems: jest.fn(() => 'formatted') };

jest.mock('./server', () => {
  mockLoaded.push('server');
  return mockServer;
});
jest.mock('./configuration', () => {
  mockLoaded.push('configuration');
  return mockConfiguration;
});
jest.mock('./problems', () => {
  mockLoaded.push('problems');
  return mockProblems;
});

const load = (): typeof import('./index') => require('./index');

describe('the entry of the package', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockLoaded.splice(0);
  });

  it('loads no part of the server on its own, which the launcher has no use for', () => {
    const api = load();

    expect(api.startLauncher).toEqual(expect.any(Function));
    expect(api.getStableScriptPath).toEqual(expect.any(Function));
    expect(mockLoaded).toEqual([]);
  });

  it('is the function that starts a server, under its other names too', async () => {
    const api = load();

    await expect(api({ portHttp: 1 })).resolves.toBe('server');

    expect(mockServer.startServer).toHaveBeenCalledWith({ portHttp: 1 });
    expect(api.default).toBe(api);
    expect(api.startServer).toBe(api);
    expect(mockLoaded).toEqual(['server']);
  });

  it('starts a cluster with what it was given', async () => {
    const options = { processHooks: false };

    await expect(load().startCluster({ portHttp: 1 }, undefined, options)).resolves.toBe('cluster');

    expect(mockServer.startCluster).toHaveBeenCalledWith({ portHttp: 1 }, undefined, options);
  });

  it('rejects, rather than throws, when the server does not start', async () => {
    mockServer.startCluster.mockRejectedValueOnce(new Error('port in use'));

    await expect(load().startCluster({})).rejects.toThrow('port in use');
  });

  it('checks a configuration without loading the server', () => {
    expect(load().checkConfiguration({ portHttp: 1 })).toEqual(['problem']);
    expect(mockConfiguration.checkConfiguration).toHaveBeenCalledWith({ portHttp: 1 });
    expect(mockLoaded).toEqual(['configuration']);
  });

  it('formats problems', () => {
    expect(load().formatProblems([])).toBe('formatted');
    expect(mockProblems.formatProblems).toHaveBeenCalledWith([]);
    expect(mockLoaded).toEqual(['problems']);
  });
});
