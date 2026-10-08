import { resolve } from 'path';

const startServer = jest.fn();

jest.mock('@koeroesi86/node-webserver', () => ({ __esModule: true, default: (...args: unknown[]) => startServer(...args) }));

const configuration = resolve(__dirname, '../../configuration.example.js');

describe('cli', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    startServer.mockReset();
    jest.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('requires a configuration', () => {
    process.argv = ['node', 'cli.js'];

    expect(() => require('./cli')).toThrow('use with --config </path/to/config>');
    expect(startServer).not.toHaveBeenCalled();
  });

  it('starts the server with the configuration it was pointed to', async () => {
    process.argv = ['node', 'cli.js', '--config', configuration];
    require('./cli');
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer.mock.calls[0][0]).toEqual(require(configuration));
  });
});
