import createLaunchdPlist from './create-launchd-plist';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/local/bin/node',
  scriptPath: '/opt/nws/dist/scripts/manageService.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

describe('createLaunchdPlist', () => {
  it('describes the label, the arguments, the folder and the restart policy', () => {
    const plist = createLaunchdPlist('com.koeroesi86.nws', definition);

    expect(plist).toContain('<key>Label</key><string>com.koeroesi86.nws</string>');
    expect(plist).toContain(
      '<array><string>/usr/local/bin/node</string><string>/opt/nws/dist/scripts/manageService.js</string><string>--run</string><string>--configuration</string><string>/etc/nws/configuration.js</string></array>'
    );
    expect(plist).toContain('<key>WorkingDirectory</key><string>/etc/nws</string>');
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).not.toContain('UserName');
    expect(plist).not.toContain('StandardOutPath');
  });

  it('adds the user and the log file when given', () => {
    const plist = createLaunchdPlist('com.koeroesi86.nws', { ...definition, user: 'www', logFolder: '/var/log/nws' });

    expect(plist).toContain('<key>UserName</key><string>www</string>');
    expect(plist).toContain('<key>StandardOutPath</key><string>/var/log/nws/nws.log</string>');
    expect(plist).toContain('<key>StandardErrorPath</key><string>/var/log/nws/nws.log</string>');
  });

  it('starts an agent of the current user at load, without a user name', () => {
    const plist = createLaunchdPlist('com.koeroesi86.nws', { ...definition, userService: true });

    expect(plist).toContain('<key>RunAtLoad</key><true/>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).not.toContain('UserName');
  });

  it('escapes xml', () => {
    expect(createLaunchdPlist('l', { ...definition, configPath: '/a&b/<c>.js' })).toContain('/a&amp;b/&lt;c&gt;.js');
  });
});
