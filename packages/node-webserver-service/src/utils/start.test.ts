import { resolve } from 'path';
import start from './start';

const startServer = jest.fn();

jest.mock('@koeroesi86/node-webserver', () => ({ __esModule: true, default: (...args: unknown[]) => startServer(...args) }));

describe('start', () => {
  beforeEach(() => startServer.mockReset());

  it('starts the server with the configuration of the path, without blocking the caller', async () => {
    const configPath = resolve(__dirname, '../../configuration.example.js');
    start(configPath);

    expect(startServer).not.toHaveBeenCalled();

    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    expect(startServer).toHaveBeenCalledWith(require(configPath));
  });
});
