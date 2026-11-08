import createTaskXml from './create-task-xml';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node  webserver',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  scriptPath: 'C:\\nws\\dist\\scripts\\cli.js',
  configPath: 'C:\\nws\\configuration.js',
  workingDirectory: 'C:\\nws',
};

describe('createTaskXml', () => {
  it('starts the server at boot as SYSTEM and restarts it', () => {
    const xml = createTaskXml(definition, 'dev');

    expect(xml).toContain('<Description>Node webserver</Description>');
    expect(xml).toContain('<BootTrigger>');
    expect(xml).toContain('<UserId>S-1-5-18</UserId>');
    expect(xml).toContain('<RunLevel>HighestAvailable</RunLevel>');
    expect(xml).toContain('<RestartOnFailure>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<Command>C:\\Program Files\\nodejs\\node.exe</Command>');
    expect(xml).toContain('<Arguments>&quot;C:\\nws\\dist\\scripts\\cli.js&quot; --config &quot;C:\\nws\\configuration.js&quot;</Arguments>');
    expect(xml).toContain('<WorkingDirectory>C:\\nws</WorkingDirectory>');
  });

  it('starts it at the logon of the user, without elevation, for a user service', () => {
    const xml = createTaskXml({ ...definition, userService: true }, 'DOMAIN\\dev');

    expect(xml).toContain('<LogonTrigger><Enabled>true</Enabled><UserId>DOMAIN\\dev</UserId></LogonTrigger>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).not.toContain('BootTrigger');
    expect(xml).not.toContain('S-1-5-18');
  });

  it('escapes xml', () => {
    expect(createTaskXml({ ...definition, configPath: 'C:\\a&b\\<c>.js' }, 'dev')).toContain('C:\\a&amp;b\\&lt;c&gt;.js');
  });
});
