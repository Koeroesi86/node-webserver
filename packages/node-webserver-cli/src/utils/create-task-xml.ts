import escapeXml from './escape-xml';
import type { ServiceDefinition } from '../types';

const SYSTEM_ACCOUNT = 'S-1-5-18';

const element = (name: string, value: string): string => `<${name}>${escapeXml(value)}</${name}>`;

const quote = (value: string): string => `"${value}"`;

/** a task that starts at boot as SYSTEM, or at the logon of the given user without elevation */
const createTaskXml = ({ displayName, nodePath, scriptPath, configPath, workingDirectory, userService }: ServiceDefinition, userName: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    `  <RegistrationInfo>${element('Description', displayName.replace(/\s+/g, ' '))}</RegistrationInfo>`,
    userService
      ? `  <Triggers><LogonTrigger><Enabled>true</Enabled>${element('UserId', userName)}</LogonTrigger></Triggers>`
      : '  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>',
    userService
      ? `  <Principals><Principal id="Author">${element('UserId', userName)}<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`
      : `  <Principals><Principal id="Author">${element('UserId', SYSTEM_ACCOUNT)}<RunLevel>HighestAvailable</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author">',
    `    <Exec>${element('Command', nodePath)}${element('Arguments', `${quote(scriptPath)} --config ${quote(configPath)}`)}${element('WorkingDirectory', workingDirectory)}</Exec>`,
    '  </Actions>',
    '</Task>',
    '',
  ].join('\n');

export default createTaskXml;
