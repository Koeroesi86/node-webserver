import type { MergedSignals } from '../types';
import createMergedSignals from './create-merged-signals';
import isPrimaryMessage from './is-primary-message';
import sendMessage from './send-message';

/**
 * The side of the server of the channel to its launcher: the signals the launcher passes on, merged with the ones of the process, and the end of the server with the one of the launcher,
 * which would leave it behind otherwise. The channel alone does not keep the process running.
 */
const connectLauncher = (signals: MergedSignals = createMergedSignals()) => {
  process.on('message', (message) => isPrimaryMessage(message) && message.nodeWebserver === 'signal' && signals.receive(message.signal));
  process.on('disconnect', () => process.exit(1));
  process.channel?.unref();
  void sendMessage({ nodeWebserver: 'hello' });

  return { signals, serving: () => sendMessage({ nodeWebserver: 'serving' }) };
};

export default connectLauncher;
