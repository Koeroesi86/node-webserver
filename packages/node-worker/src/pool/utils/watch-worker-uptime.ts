import startUnrefTimer from './start-unref-timer';

/** A worker that has been up for a while is healthy, whatever the ones before it did. */
const watchWorkerUptime = (minUptime: number, onStable: () => void) => {
  let stable = false;
  const timer = startUnrefTimer(() => {
    stable = true;
    onStable();
  }, minUptime);

  return {
    isStable: () => stable,
    stop: () => clearTimeout(timer),
  };
};

export type WorkerUptime = ReturnType<typeof watchWorkerUptime>;

export default watchWorkerUptime;
