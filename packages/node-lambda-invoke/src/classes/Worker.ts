import { spawn } from 'child_process';
import type { ChildProcess, Serializable, SpawnOptions } from 'child_process';
import type { Listener } from '../types';

// TODO: move this to separate package
class Worker {
  readonly workerPath: string;
  instance?: ChildProcess;

  constructor(workerPath: string, options: SpawnOptions = {}) {
    this.workerPath = workerPath;
    const instance = spawn('node', [...this.workerPath.split(' ')], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      ...options,
    });
    this.instance = instance;

    if (instance.stdout) {
      const messageListener = (data: Buffer | string) => {
        console.info(data.toString().trim());
      };
      instance.stdout.on('data', messageListener);
    }
    instance.once('close', () => {
      delete this.instance;
    });

    this.addEventListener = this.addEventListener.bind(this);
    this.removeEventListener = this.removeEventListener.bind(this);
    this.terminate = this.terminate.bind(this);
    this.postMessage = this.postMessage.bind(this);
    this.send = this.send.bind(this);
  }

  set onmessage(onmessage: Listener) {
    this.addEventListener('message', onmessage);
  }

  set onerror(onerror: Listener) {
    this.addEventListener('error', onerror);
  }

  get stdout() {
    return this.instance?.stdout;
  }

  get stderr() {
    return this.instance?.stderr;
  }

  addEventListener(event: string, listener: Listener) {
    if (this.instance) this.instance.on(event, listener);
  }

  addEventListenerOnce(event: string, listener: Listener) {
    if (this.instance) this.instance.once(event, listener);
  }

  on(event: string, listener: Listener) {
    this.addEventListener(event, listener);
  }

  off(event: string, listener: Listener) {
    this.removeEventListener(event, listener);
  }

  send(message: Serializable, cb: (error: Error | null) => void = () => {}) {
    this.postMessage(message, cb);
  }

  removeEventListener(event: string, listener: Listener) {
    if (this.instance && this.instance.off) this.instance.off(event, listener);
  }

  // from EventTarget prototype, if needed
  // dispatchEvent() {
  //
  // }

  terminate() {
    if (this.instance) this.instance.kill('SIGINT');
  }

  postMessage(message: Serializable, cb: (error: Error | null) => void = () => {}) {
    if (this.instance) this.instance.send(message, cb);
  }
}

export default Worker;
