import { ChildProcess, Serializable, spawn } from 'child_process';
import type { WorkerOptions } from './types';

/** `require('@koeroesi86/node-worker')` returns the class itself */
class Worker implements EventTarget {
  readonly commandParts: string[];
  readonly instance: ChildProcess;

  /** `command` is split on spaces, an array is taken as it is: the executable, then its arguments */
  constructor(command: string | string[], { execArgv = [], ...options }: WorkerOptions = {}) {
    this.commandParts = Array.isArray(command) ? command : command.split(' ');
    this.instance = spawn(this.commandParts[0], [...execArgv, ...this.commandParts.slice(1)], options);
  }

  get stdout() {
    return this.instance.stdout;
  }

  get stderr() {
    return this.instance.stderr;
  }

  /** whether the process is gone, by exiting or by a signal */
  get exited() {
    return this.instance.exitCode !== null || this.instance.signalCode !== null;
  }

  set onmessage(onmessage: (...args: unknown[]) => unknown) {
    this.addEventListener('message', onmessage);
  }

  set onerror(onerror: (...args: unknown[]) => unknown) {
    this.addEventListener('error', onerror);
  }

  addEventListener = (event: string, listener: (...args: unknown[]) => unknown) => {
    if (this.instance.exitCode === null) {
      this.instance.on(event, listener);
    }
  };

  addEventListenerOnce = <Args extends unknown[]>(event: string, listener: (...args: Args) => unknown) => {
    if (this.instance.exitCode === null) {
      this.instance.once(event, listener);
    }
  };

  removeEventListener = (event: string, listener: (...args: unknown[]) => unknown) => {
    if (this.instance.exitCode === null) {
      this.instance.off(event, listener);
    }
  };

  dispatchEvent = ({ type, payload = '' }: Event & { payload?: Serializable }) => {
    if (this.instance.exitCode === null) {
      return this.instance.emit(type, payload);
    }

    return false;
  };

  /** SIGINT lets a worker finish, one that ignores it is stopped with SIGTERM and then SIGKILL */
  terminate = (signal: NodeJS.Signals = 'SIGINT') => {
    if (!this.exited) {
      this.instance.kill(signal);
    }
  };

  postMessage = (message: Serializable, cb: (error: Error | null) => void = () => {}) => {
    if (this.instance.exitCode === null) {
      this.instance.send(message, cb);
    }
  };
}

export = Worker;
