import createSystemdUnit from './create-systemd-unit';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/bin/node',
  scriptPath: '/opt/nws/dist/scripts/manageService.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

describe('createSystemdUnit', () => {
  it('starts the script with absolute paths, restarts on failure and starts at boot', () => {
    const unit = createSystemdUnit(definition);

    expect(unit).toContain('Description=Node webserver');
    expect(unit).toContain('ExecStart="/usr/bin/node" "/opt/nws/dist/scripts/manageService.js" "--run" "--configuration" "/etc/nws/configuration.js"');
    expect(unit).toContain('WorkingDirectory=/etc/nws');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=multi-user.target');
    expect(unit).not.toContain('User=');
  });

  it('runs as the user of the configuration', () => {
    expect(createSystemdUnit({ ...definition, user: 'www' })).toContain('\nUser=www\n');
  });

  it('quotes what systemd would expand or split', () => {
    const unit = createSystemdUnit({ ...definition, configPath: '/etc/my "conf" $HOME 100%/c.js', displayName: 'a\nb', workingDirectory: '/etc/my dir' });

    expect(unit).toContain('"/etc/my \\"conf\\" $$HOME 100%%/c.js"');
    expect(unit).toContain('Description=a b');
    expect(unit).toContain('WorkingDirectory=/etc/my\\x20dir');
  });
});
