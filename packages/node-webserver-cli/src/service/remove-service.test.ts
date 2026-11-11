import removeService from './remove-service';
import type { ServiceDefinition } from '../types';

const definition: ServiceDefinition = {
  name: 'nws',
  displayName: 'Node webserver',
  nodePath: '/usr/bin/node',
  scriptPath: '/opt/nws/dist/scripts/cli.js',
  configPath: '/etc/nws/configuration.js',
  workingDirectory: '/etc/nws',
};

describe('removeService', () => {
  it('unloads the service, deletes its file and then reloads systemd', async () => {
    const order: string[] = [];
    const runCommand = jest.fn(async (command: string, args: string[]) => void order.push(`${command} ${args[0]}`));
    const removeFile = jest.fn(async (path: string) => void order.push(`rm ${path}`));

    await removeService(definition, { platform: 'linux', runCommand, removeFile }, { home: '/home/dev', uid: 1000 });

    expect(order).toEqual(['systemctl disable', 'rm /etc/systemd/system/nws.service', 'systemctl daemon-reload']);
  });

  it('says to run as root when the file cannot be deleted', async () => {
    const removeFile = jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await expect(removeService(definition, { platform: 'darwin', runCommand: jest.fn(), removeFile })).rejects.toThrow('run this as root');
  });

  it('stops the task of Windows and goes on when it is not running', async () => {
    const order: string[] = [];
    const runCommand = jest.fn(async (command: string, args: string[]) => {
      order.push(`${command} ${args[0]}`);
      if (args[0] === '/end') throw new Error('no running instance');
    });

    await removeService(definition, { platform: 'win32', runCommand, removeFile: jest.fn() }, { home: 'C:\\Users\\dev', uid: undefined, userName: 'dev' });

    expect(order).toEqual(['schtasks /end', 'schtasks /delete']);
  });
});
