import installService from './install-service';
import removeService from './remove-service';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/bin/node',
  scriptPath: '/opt/nws/dist/scripts/manage-service.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

const denied = () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }));

describe('installService and removeService', () => {
  const writeFile = jest.fn();
  const removeFile = jest.fn();
  const runCommand = jest.fn();

  beforeEach(() => {
    [writeFile, removeFile, runCommand].forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  });

  it('writes the unit, then enables and starts it with systemd', async () => {
    await installService(definition, { platform: 'linux', writeFile, runCommand });

    expect(writeFile).toHaveBeenCalledWith('/etc/systemd/system/nws.service', expect.stringContaining('ExecStart='));
    expect(runCommand.mock.calls).toEqual([
      ['systemctl', ['daemon-reload']],
      ['systemctl', ['enable', '--now', 'nws']],
    ]);
  });

  it('writes the plist and bootstraps it with launchd', async () => {
    await installService(definition, { platform: 'darwin', writeFile, runCommand });

    expect(writeFile).toHaveBeenCalledWith('/Library/LaunchDaemons/com.koeroesi86.nws.plist', expect.stringContaining('com.koeroesi86.nws'));
    expect(runCommand).toHaveBeenCalledWith('launchctl', ['bootstrap', 'system', '/Library/LaunchDaemons/com.koeroesi86.nws.plist']);
  });

  it('stops and disables the unit before it deletes the file, and reloads systemd after', async () => {
    const order: string[] = [];
    runCommand.mockImplementation(async (command: string, args: string[]) => void order.push(`${command} ${args[0]}`));
    removeFile.mockImplementation(async () => void order.push('rm'));

    await removeService(definition, { platform: 'linux', runCommand, removeFile });

    expect(order).toEqual(['systemctl disable', 'rm', 'systemctl daemon-reload']);
    expect(removeFile).toHaveBeenCalledWith('/etc/systemd/system/nws.service');
  });

  it('boots the job out of launchd before it deletes the plist', async () => {
    await removeService(definition, { platform: 'darwin', runCommand, removeFile });

    expect(runCommand).toHaveBeenCalledWith('launchctl', ['bootout', 'system/com.koeroesi86.nws']);
    expect(removeFile).toHaveBeenCalledWith('/Library/LaunchDaemons/com.koeroesi86.nws.plist');
  });

  it('says root is needed instead of a bare EACCES', async () => {
    writeFile.mockImplementation(denied);
    removeFile.mockImplementation(denied);

    await expect(installService(definition, { platform: 'linux', writeFile, runCommand })).rejects.toThrow('run this as root');
    expect(runCommand).not.toHaveBeenCalled();
    await expect(removeService(definition, { platform: 'linux', runCommand, removeFile })).rejects.toThrow('run this as root');
  });

  it('passes on other errors, and a failing command', async () => {
    writeFile.mockRejectedValue(new Error('disk full'));
    await expect(installService(definition, { platform: 'linux', writeFile, runCommand })).rejects.toThrow('disk full');

    runCommand.mockRejectedValue(new Error('systemctl failed'));
    await expect(removeService(definition, { platform: 'linux', runCommand, removeFile })).rejects.toThrow('systemctl failed');
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('does not generate a service for windows, and says what to do', async () => {
    await expect(installService(definition, { platform: 'win32', writeFile, runCommand })).rejects.toThrow('WinSW');
    await expect(removeService(definition, { platform: 'win32', runCommand, removeFile })).rejects.toThrow('not for win32');
    expect(writeFile).not.toHaveBeenCalled();
  });

  describe('for the current user', () => {
    const userDefinition: ServiceDefinition = { ...definition, userService: true };
    const user = { home: '/home/dev', uid: 1000 };
    const makeFolder = jest.fn();

    beforeEach(() => makeFolder.mockReset().mockResolvedValue(undefined));

    it('writes the unit into the user folder and enables it with the user manager of systemd', async () => {
      await installService(userDefinition, { platform: 'linux', makeFolder, writeFile, runCommand }, user);

      expect(makeFolder).toHaveBeenCalledWith('/home/dev/.config/systemd/user');
      expect(writeFile).toHaveBeenCalledWith('/home/dev/.config/systemd/user/nws.service', expect.stringContaining('WantedBy=default.target'));
      expect(runCommand.mock.calls).toEqual([
        ['systemctl', ['--user', 'daemon-reload']],
        ['systemctl', ['--user', 'enable', '--now', 'nws']],
      ]);
    });

    it('bootstraps the agent into the gui domain of the user with launchd', async () => {
      await installService(userDefinition, { platform: 'darwin', makeFolder, writeFile, runCommand }, user);

      expect(makeFolder).toHaveBeenCalledWith('/home/dev/Library/LaunchAgents');
      expect(runCommand).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/1000', '/home/dev/Library/LaunchAgents/com.koeroesi86.nws.plist']);
    });

    it('removes the user unit and the agent', async () => {
      await removeService(userDefinition, { platform: 'linux', runCommand, removeFile }, user);
      expect(runCommand.mock.calls).toEqual([
        ['systemctl', ['--user', 'disable', '--now', 'nws']],
        ['systemctl', ['--user', 'daemon-reload']],
      ]);
      expect(removeFile).toHaveBeenCalledWith('/home/dev/.config/systemd/user/nws.service');

      await removeService(userDefinition, { platform: 'darwin', runCommand, removeFile }, user);
      expect(runCommand).toHaveBeenCalledWith('launchctl', ['bootout', 'gui/1000/com.koeroesi86.nws']);
    });

    it('needs the user id on macOS', async () => {
      await expect(
        installService(userDefinition, { platform: 'darwin', makeFolder, writeFile, runCommand }, { home: '/home/dev', uid: undefined })
      ).rejects.toThrow('user id');
    });

    it('does not create a folder for the system service', async () => {
      await installService(definition, { platform: 'linux', makeFolder, writeFile, runCommand });
      expect(makeFolder).not.toHaveBeenCalled();
    });
  });
});
