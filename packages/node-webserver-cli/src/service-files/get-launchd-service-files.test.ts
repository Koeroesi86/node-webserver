import getLaunchdServiceFiles from './get-launchd-service-files';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/local/bin/node',
  scriptPath: '/opt/nws/dist/scripts/cli.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

describe('getLaunchdServiceFiles', () => {
  it('describes a daemon of the system domain, which needs no folder', () => {
    const files = getLaunchdServiceFiles(definition, '/Users/dev', 501);

    expect(files.filePath).toBe('/Library/LaunchDaemons/com.koeroesi86.nws.plist');
    expect(files.folder).toBeUndefined();
    expect(files.install).toEqual([['launchctl', 'bootstrap', 'system', files.filePath]]);
  });

  it('describes an agent of the gui domain of the user', () => {
    const files = getLaunchdServiceFiles({ ...definition, userService: true }, '/Users/dev', 501);

    expect(files.filePath).toBe('/Users/dev/Library/LaunchAgents/com.koeroesi86.nws.plist');
    expect(files.folder).toBe('/Users/dev/Library/LaunchAgents');
    expect(files.remove).toEqual([['launchctl', 'bootout', 'gui/501/com.koeroesi86.nws']]);
  });

  it('needs the user id for an agent', () => {
    expect(() => getLaunchdServiceFiles({ ...definition, userService: true }, '/Users/dev', undefined)).toThrow('user id');
  });
});
