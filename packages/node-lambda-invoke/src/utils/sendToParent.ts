import type { Serializable } from 'child_process';

const sendToParent = (message: Serializable) => {
  if (!process.send) {
    throw new Error('There is no IPC channel to the parent process.');
  }

  process.send(message);
};

export default sendToParent;
