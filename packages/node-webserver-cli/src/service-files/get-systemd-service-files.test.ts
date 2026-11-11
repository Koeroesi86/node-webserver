import getSystemdServiceFiles from './get-systemd-service-files';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/bin/node',
  scriptPath: '/opt/nws/dist/scripts/cli.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

describe('getSystemdServiceFiles', () => {
  it('describes a system unit, which needs no folder', () => {
    const files = getSystemdServiceFiles(definition, '/home/dev');

    expect(files.filePath).toBe('/etc/systemd/system/nws.service');
    expect(files.folder).toBeUndefined();
    expect(files.install[1]).toEqual(['systemctl', 'enable', '--now', 'nws']);
    expect(files.stop).toEqual([]);
  });

  it('describes a user unit in the folder of the home', () => {
    const files = getSystemdServiceFiles({ ...definition, userService: true }, '/home/dev');

    expect(files.filePath).toBe('/home/dev/.config/systemd/user/nws.service');
    expect(files.folder).toBe('/home/dev/.config/systemd/user');
    expect(files.remove).toEqual([['systemctl', '--user', 'disable', '--now', 'nws']]);
  });
});
