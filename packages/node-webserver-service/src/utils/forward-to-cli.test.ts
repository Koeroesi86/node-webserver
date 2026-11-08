import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forwardToCli from './forward-to-cli';

const resolveCliScript = jest.fn();

jest.mock('./resolve-cli-script', () => ({ __esModule: true, default: () => resolveCliScript() }));

// a signal cannot be sent to a process on Windows, which ends it at once
const itWithSignals = process.platform === 'win32' ? it.skip : it;

const until = async (condition: () => boolean) => {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('forwardToCli', () => {
  const originalExitCode = process.exitCode;
  let folder: string;
  let argvFile: string;
  let readyFile: string;

  /** a stand-in for nws-cli: writes the arguments it got, and ends as the test tells it to */
  const useScript = (body: string) => {
    const script = join(folder, 'cli.js');
    writeFileSync(
      script,
      `const { writeFileSync } = require('node:fs');
       writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
       ${body}`
    );
    resolveCliScript.mockReturnValue(script);
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'forward-to-cli-'));
    argvFile = join(folder, 'argv.json');
    readyFile = join(folder, 'ready');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
  });

  it('runs nws-cli with the translated arguments and says the package is deprecated', async () => {
    useScript('process.exit(0);');

    await forwardToCli(['--add', '--user', '--configuration', 'c.js']);

    expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toEqual(['service', 'add', '--user', '--config', 'c.js']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('npx nws-cli service add --user --config c.js'));
    expect(process.exitCode).toBe(0);
  });

  it('exits with the code of nws-cli', async () => {
    useScript('process.exit(3);');

    await forwardToCli(['--remove']);

    expect(process.exitCode).toBe(3);
  });

  itWithSignals('passes SIGTERM on to nws-cli and waits for it to finish', async () => {
    useScript(`process.on('SIGTERM', () => process.exit(7)); writeFileSync(${JSON.stringify(readyFile)}, ''); setInterval(() => undefined, 1000);`);

    const forwarded = forwardToCli(['--run']);
    await until(() => existsSync(readyFile));
    process.emit('SIGTERM');
    await forwarded;

    expect(process.exitCode).toBe(7);
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });

  itWithSignals('ends with the signal that ended nws-cli', async () => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    useScript("process.kill(process.pid, 'SIGKILL');");

    await forwardToCli(['--run']);

    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGKILL');
  });
});
