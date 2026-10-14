/** A worker that has been up for a while is healthy, whatever the ones before it did. */
const watchWorkerUptime = (minUptime: number, onStable: () => void) => {
  let stable = false;
  const timer = setTimeout(() => {
    stable = true;
    onStable();
  }, minUptime);
  timer.unref();

  return {
    isStable: () => stable,
    stop: () => clearTimeout(timer),
  };
};

export type WorkerUptime = ReturnType<typeof watchWorkerUptime>;

export default watchWorkerUptime;
