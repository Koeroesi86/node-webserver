import { ChildProcess, Serializable, spawn } from 'child_process';

export default class Worker implements EventTarget {
  readonly commandParts: string[];
  readonly instance: ChildProcess;

  constructor(command: string, options: Parameters<typeof spawn>[2] = {}) {
    this.commandParts = command.split(' ');
    this.instance = spawn(this.commandParts[0], [...this.commandParts.slice(1)], options);
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

  addEventListenerOnce = (event: string, listener: (...args: unknown[]) => unknown) => {
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

  terminate = () => {
    if (this.instance.exitCode === null) {
      this.instance.kill('SIGINT');
    }
  };

  postMessage = (message: Serializable, cb: (error: Error | null) => void = () => {}) => {
    if (this.instance.exitCode === null) {
      this.instance.send(message, cb);
    }
  };
}
