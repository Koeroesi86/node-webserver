import { posix } from 'path';
import type { ServiceDefinition } from '../types';

const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const string = (value: string): string => `<string>${escapeXml(value)}</string>`;

const createLaunchdPlist = (label: string, { name, nodePath, scriptPath, configPath, workingDirectory, user, logFolder }: ServiceDefinition): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>${string(label)}`,
    `  <key>ProgramArguments</key><array>${[nodePath, scriptPath, '--run', '--configuration', configPath].map(string).join('')}</array>`,
    `  <key>WorkingDirectory</key>${string(workingDirectory)}`,
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><true/>',
    ...(user ? [`  <key>UserName</key>${string(user)}`] : []),
    ...(logFolder
      ? [
          `  <key>StandardOutPath</key>${string(posix.join(logFolder, `${name}.log`))}`,
          `  <key>StandardErrorPath</key>${string(posix.join(logFolder, `${name}.log`))}`,
        ]
      : []),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

export default createLaunchdPlist;
