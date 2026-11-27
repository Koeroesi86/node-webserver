import startLauncher from './start-launcher';
import { createLauncher, getFrontProcess, getLauncherMode } from '../cluster';

jest.mock('../cluster', () => ({ createLauncher: jest.fn(), forkServer: jest.fn(), getFrontProcess: jest.fn(), getLauncherMode: jest.fn() }));

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

  it.each([
    ['a front', () => jest.mocked(getFrontProcess).mockReturnValue({ index: 0, count: 1 })],
    ['the server that was launched', () => jest.mocked(getLauncherMode).mockReturnValue('restart')],
  ])('does nothing in %s', (_, set) => {
    set();

    expect(startLauncher()).toBe(false);
    expect(createLauncher).not.toHaveBeenCalled();
  });
});
