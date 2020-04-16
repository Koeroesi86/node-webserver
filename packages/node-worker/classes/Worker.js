const { spawn } = require('child_process');

/**
 * @class {EventTarget} Worker
 */
class Worker {
  /**
   * @param {string} command
   * @param {Object} options
   */
  constructor(command = '', options = {}) {
    this.commandParts = command.split(' ');
    /**
     * @type {ChildProcess}
     */
    this.instance = spawn(
      this.commandParts[0],
      [
        ...this.commandParts.slice(1)
      ],
      options
    );
    this.instance.once('close', () => {
      this.instance = null;
      delete this.instance;
    });

    this.addEventListener = this.addEventListener.bind(this);
    this.removeEventListener = this.removeEventListener.bind(this);
    this.terminate = this.terminate.bind(this);
    this.postMessage = this.postMessage.bind(this);
  }

  /**
   * @param {Function} onmessage
   */
  set onmessage(onmessage) {
    this.addEventListener('message', onmessage);
  }

  /**
   * @param {Function} onerror
   */
  set onerror(onerror) {
    this.addEventListener('error', onerror);
  }

  /**
   * @param {String} event
   * @param {Function} listener
   */
  addEventListener(event, listener) {
    if (this.instance) this.instance.on(event, listener);
  }

  /**
   * @param {String} event
   * @param {Function} listener
   */
  addEventListenerOnce(event, listener) {
    if (this.instance) this.instance.once(event, listener);
  }

  /**
   * @param {String} event
   * @param {Function} listener
   */
  removeEventListener(event, listener) {
    if (this.instance && this.instance.off) this.instance.off(event, listener);
  }

  /**
   * @param {string} eventName
   * @param [payload]
   */
  dispatchEvent(eventName = '', payload) {
    if (this.instance && this.instance.emit) {
      this.instance.emit(eventName, payload);
    }
  }

  terminate() {
    if (this.instance) this.instance.kill('SIGINT');
  }

  /**
   * @param {*} message
   * @param {Function} [cb]
   */
  postMessage(message, cb = () => {}) {
    if (this.instance && this.instance.send) this.instance.send(message, cb);
  }
}

module.exports = Worker;
