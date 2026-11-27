import startLauncher from './start-launcher';
import createLauncher from './create-launcher';
import forkServer from './fork-server';
import getFrontProcess from './get-front-process';
import getLauncherMode from './get-launcher-mode';
import getStableScriptPath from './get-stable-script-path';

jest.mock('./create-launcher', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./fork-server', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./get-front-process', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./get-launcher-mode', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./get-stable-script-path', () => ({ __esModule: true, default: jest.fn(() => '/app/current/cli.js') }));

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
