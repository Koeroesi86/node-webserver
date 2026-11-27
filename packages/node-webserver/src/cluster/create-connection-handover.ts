import type { Worker } from 'cluster';
import type { ClusterInternalMessage } from '../types';

const isClusterMessage = (message: unknown): message is ClusterInternalMessage =>
  typeof message === 'object' && message !== null && 'cmd' in message && message.cmd === 'NODE_CLUSTER';

/**
 * With round robin `node:cluster` hands a connection to a front and keeps it open until the front answers. A front that ends before it does never answers, and cluster does nothing
 * about it: the connection stays open in the primary, and its client waits until it gives up. This answers for such a front, which has cluster hand the connection to another one.
 *
 * It follows the messages of cluster itself, which are not part of the API of Node: should they change, it does nothing.
 */
const createConnectionHandover = () => {
  /** what each front that can be reached listens on */
  const fronts = new Set<Set<string>>();
  const isListenedOn = (key: string) => Array.from(fronts).some((listensOn) => listensOn.has(key));

  /** takes a front that was just forked */
  return (worker: Worker) => {
    const child = worker.process;
    const { send, disconnect } = child;
    const listensOn = new Set<string>();
    /** what the connections that the front did not answer yet came in on, by the number of the message that handed each over */
    const unanswered = new Map<number, string>();
    fronts.add(listensOn);

    const sent = (message: unknown) => {
      if (!isClusterMessage(message) || message.key === undefined) return;
      // what is no connection is the answer to a front that asked to listen
      if (message.act !== 'newconn' && !message.errno) listensOn.add(message.key);
      if (message.act === 'newconn' && message.seq !== undefined) unanswered.set(message.seq, message.key);
    };

    Object.assign(child, {
      send: (...args: unknown[]) => {
        sent(args[0]);
        return Reflect.apply(send, child, args);
      },
      // called once the channel closed, after all the front said has arrived. Cluster keeps such a front until its process ends, or for good while a connection is unanswered,
      // and drops what it would hand to it
      disconnect: () => {
        Reflect.apply(disconnect, child, []);
        fronts.delete(listensOn);
        worker.disconnect();
      },
    });
    child.on('internalMessage', (message: unknown) => {
      if (!isClusterMessage(message)) return;
      if (message.ack !== undefined) unanswered.delete(message.ack);
      if (message.act === 'close' && message.key !== undefined) listensOn.delete(message.key);
    });
    // only now is it known that the front did not take them: it ended, and nothing of it is left to be read
    child.once('close', () =>
      unanswered.forEach((key, ack) =>
        // refused, cluster hands the connection to another front. With none that listens it would keep it forever, so it is taken as accepted, which closes it
        child.emit('internalMessage', { cmd: 'NODE_CLUSTER', ack, accepted: !isListenedOn(key) })
      )
    );
  };
};

export default createConnectionHandover;
