import getServiceFiles from './get-service-files';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/bin/node',
  scriptPath: '/opt/nws/dist/scripts/cli.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};
const user = { home: '/home/dev', uid: 1000 };

describe('getServiceFiles', () => {
  it('describes a system unit of systemd', () => {
    const files = getServiceFiles('linux', definition, user);

    expect(files.filePath).toBe('/etc/systemd/system/nws.service');
    expect(files.content).toContain('ExecStart=');
    expect(files.install).toEqual([
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'enable', '--now', 'nws'],
    ]);
    expect(files.remove).toEqual([['systemctl', 'disable', '--now', 'nws']]);
    expect(files.afterRemove).toEqual([['systemctl', 'daemon-reload']]);
  });

  it('describes a user unit of systemd in the home folder', () => {
    const files = getServiceFiles('linux', { ...definition, userService: true }, user);

    expect(files.filePath).toBe('/home/dev/.config/systemd/user/nws.service');
    expect(files.install[1]).toEqual(['systemctl', '--user', 'enable', '--now', 'nws']);
  });

  it('describes a daemon and an agent of launchd', () => {
    const daemon = getServiceFiles('darwin', definition, user);
    const agent = getServiceFiles('darwin', { ...definition, userService: true }, user);

    expect(daemon.filePath).toBe('/Library/LaunchDaemons/com.koeroesi86.nws.plist');
    expect(daemon.install).toEqual([['launchctl', 'bootstrap', 'system', daemon.filePath]]);
    expect(agent.filePath).toBe('/home/dev/Library/LaunchAgents/com.koeroesi86.nws.plist');
    expect(agent.remove).toEqual([['launchctl', 'bootout', 'gui/1000/com.koeroesi86.nws']]);
  });

  it('needs the user id for an agent of launchd', () => {
    expect(() => getServiceFiles('darwin', { ...definition, userService: true }, { home: '/home/dev', uid: undefined })).toThrow('user id');
  });

  it('creates the folder of a user service only', () => {
    expect(getServiceFiles('linux', definition, user).folder).toBeUndefined();
    expect(getServiceFiles('linux', { ...definition, userService: true }, user).folder).toBe('/home/dev/.config/systemd/user');
    expect(getServiceFiles('darwin', { ...definition, userService: true }, user).folder).toBe('/home/dev/Library/LaunchAgents');
  });

  it('describes a task of Task Scheduler on Windows', () => {
    const files = getServiceFiles('win32', definition, { ...user, userName: 'dev' });

    expect(files.filePath).toMatch(/nws-cli\\nws\.xml$/);
    expect(files.content).toContain('<BootTrigger>');
    expect(files.install[1]).toEqual(['schtasks', '/run', '/tn', 'nws']);
    expect(files.remove).toEqual([['schtasks', '/delete', '/tn', 'nws', '/f']]);
  });

  it('names the platforms with a generator for the others', () => {
    expect(() => getServiceFiles('freebsd', definition, user)).toThrow('not for freebsd');
  });
});
