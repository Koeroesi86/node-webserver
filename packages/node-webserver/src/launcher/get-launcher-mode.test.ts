import { LAUNCHER_ENV } from '../constants';

const load = () => {
  let mode: unknown;
  jest.isolateModules(() => {
    mode = require('./get-launcher-mode').default();
  });
  return mode;
};

describe('getLauncherMode', () => {
  const originalSend = process.send;

  beforeEach(() => (process.send = jest.fn()));

  afterEach(() => {
    process.send = originalSend;
    delete process.env[LAUNCHER_ENV];
  });

  it.each(['start', 'restart'])('is %s when the launcher says so, which nothing started by the server is told', (mode) => {
    process.env[LAUNCHER_ENV] = mode;

    expect(load()).toBe(mode);
    expect(process.env[LAUNCHER_ENV]).toBeUndefined();
  });

  it.each([[undefined], ['other']])('is nothing for %s', (value) => {
    if (value) process.env[LAUNCHER_ENV] = value;

    expect(load()).toBeUndefined();
  });

  it('is nothing without a channel to a launcher', () => {
    process.send = undefined;
    process.env[LAUNCHER_ENV] = 'start';

    expect(load()).toBeUndefined();
  });
});
