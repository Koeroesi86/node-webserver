import { resolve } from 'path';
import start from './start';

const startServer = jest.fn();

jest.mock('@koeroesi86/node-webserver', () => ({ __esModule: true, default: (...args: unknown[]) => startServer(...args) }));

describe('start', () => {
  const configPath = resolve(__dirname, '../../configuration.example.js');

  beforeEach(() => startServer.mockReset());

  it('starts the server with the configuration of the path', async () => {
    await start(configPath);

    expect(startServer).toHaveBeenCalledWith(require(configPath));
  });

  it('rejects when the server does not start, so the caller can exit with an error', async () => {
    startServer.mockRejectedValue(new Error('port in use'));

    await expect(start(configPath)).rejects.toThrow('port in use');
  });
});
