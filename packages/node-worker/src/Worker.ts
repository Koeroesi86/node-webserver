import { ChildProcess, Serializable, spawn } from 'child_process';

export default class Worker implements EventTarget {
  readonly commandParts: string[];
  protected instance?: ChildProcess | null;

  constructor(command: string, options: Parameters<typeof spawn>[2] = {}) {
    this.commandParts = command.split(' ');
    this.instance = spawn(this.commandParts[0], [...this.commandParts.slice(1)], options);
    this.instance.once('close', () => {
      this.instance = null;
      delete this.instance;
    });
  }

  set onmessage(onmessage: (...args: unknown[]) => unknown) {
    this.addEventListener('message', onmessage);
  }

  set onerror(onerror: (...args: unknown[]) => unknown) {
    this.addEventListener('error', onerror);
  }

  addEventListener = (event: string, listener: (...args: unknown[]) => unknown) => {
    if (this.instance) this.instance.on(event, listener);
  };

  addEventListenerOnce = (event: string, listener: (...args: unknown[]) => unknown) => {
    if (this.instance) this.instance.once(event, listener);
  };

  removeEventListener = (event: string, listener: (...args: unknown[]) => unknown) => {
    if (this.instance && this.instance.off) this.instance.off(event, listener);
  };

  dispatchEvent = ({ type, payload = '' }: Event & { payload?: Serializable }) => {
    if (this.instance && this.instance.emit) {
      return this.instance.emit(type, payload);
    }

    return false;
  };

  terminate = () => {
    if (this.instance) this.instance.kill('SIGINT');
  };

  postMessage = (message: Serializable, cb: (error: Error | null) => void = () => {}) => {
    if (this.instance && this.instance.send) this.instance.send(message, cb);
  };
}
