import type { ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';

const childProcessMock: ChildProcess = {
  stdin: new Writable(),
  stdout: new Readable(),
  stderr: new Readable(),
  stdio: [null, null, null, null, null],
  killed: false,
  connected: false,
  exitCode: null,
  signalCode: null,
  spawnargs: [],
  spawnfile: '',
  kill: jest.fn(),
  send: jest.fn(),
  disconnect: jest.fn(),
  unref: jest.fn(),
  ref: jest.fn(),
  addListener: jest.fn(),
  emit: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  prependListener: jest.fn(),
  prependOnceListener: jest.fn(),
  removeListener: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
  setMaxListeners: jest.fn(),
  getMaxListeners: jest.fn(() => 0),
  listeners: jest.fn(() => []),
  rawListeners: jest.fn(() => []),
  listenerCount: jest.fn(() => 0),
  eventNames: jest.fn(() => []),
};

export const spawn = jest.fn((spawnfile: string, spawnargs: string[], options: { stdio: string[] }) => childProcessMock);
