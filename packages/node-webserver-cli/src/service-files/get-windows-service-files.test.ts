import getWindowsServiceFiles from './get-windows-service-files';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  scriptPath: 'C:\\nws\\dist\\scripts\\cli.js',
  configPath: 'C:\\nws\\configuration.js',
  workingDirectory: 'C:\\nws',
};

describe('getWindowsServiceFiles', () => {
  it('keeps the task of all users in the folder of the program data, imports it and starts it', () => {
    const files = getWindowsServiceFiles(definition, 'C:\\Users\\dev', 'dev');

    expect(files.folder).toMatch(/nws-cli$/);
    expect(files.filePath).toBe(`${files.folder}\\nws.xml`);
    expect(files.install).toEqual([
      ['schtasks', '/create', '/tn', 'nws', '/xml', files.filePath, '/f'],
      ['schtasks', '/run', '/tn', 'nws'],
    ]);
    expect(files.stop).toEqual([['schtasks', '/end', '/tn', 'nws']]);
    expect(files.remove).toEqual([['schtasks', '/delete', '/tn', 'nws', '/f']]);
    expect(files.afterRemove).toEqual([]);
  });

  it('keeps the task of a user service in the local app data of the user', () => {
    const files = getWindowsServiceFiles({ ...definition, userService: true }, 'C:\\Users\\dev', 'dev');

    expect(files.folder).toBe('C:\\Users\\dev\\AppData\\Local\\nws-cli');
    expect(files.content).toContain('<LogonTrigger>');
  });

  it('refuses serviceUser, a task has no password to run as another user', () => {
    expect(() => getWindowsServiceFiles({ ...definition, user: 'www' }, 'C:\\Users\\dev', 'dev')).toThrow('serviceUser is not supported on Windows');
  });
});
