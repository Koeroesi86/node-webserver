import startLauncher from './start-launcher';
import { createLauncher, forkServer, getFrontProcess, getLauncherMode, getStableScriptPath } from '../cluster';

jest.mock('../cluster', () => ({
  createLauncher: jest.fn(),
  forkServer: jest.fn(),
  getFrontProcess: jest.fn(),
  getLauncherMode: jest.fn(),
  getStableScriptPath: jest.fn(() => '/app/current/cli.js'),
}));

describe('startLauncher', () => {
  const start = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createLauncher).mockReturnValue({ start });
    jest.mocked(getFrontProcess).mockReturnValue(undefined);
    jest.mocked(getLauncherMode).mockReturnValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('makes this process the launcher, which says what it does on stderr', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(startLauncher()).toBe(true);
    jest.mocked(createLauncher).mock.calls[0][0].log('again');

    expect(start).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[launcher] again');
  });

  it('starts the server by the path that leads to its next version, worked out before it starts any', () => {
    startLauncher();
    expect(getStableScriptPath).toHaveBeenCalledWith(process.argv[1]);

    jest.mocked(createLauncher).mock.calls[0][0].fork('restart');

    expect(forkServer).toHaveBeenCalledWith('restart', '/app/current/cli.js');
  });

  it.each([
    ['a front', () => jest.mocked(getFrontProcess).mockReturnValue({ index: 0, count: 1 })],
    ['the server that was launched', () => jest.mocked(getLauncherMode).mockReturnValue('restart')],
  ])('does nothing in %s', (_, set) => {
    set();

    expect(startLauncher()).toBe(false);
    expect(createLauncher).not.toHaveBeenCalled();
  });
});
