/** Settles once: when the worker said it is ready, or when it ended or ran out of time before. Nobody has to wait for it, so a failure is no unhandled rejection. */
const createWorkerReadiness = () => {
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  promise.catch(() => {});

  return {
    promise,
    resolve: () => settle?.resolve(),
    reject: (error: Error) => settle?.reject(error),
  };
};

export type WorkerReadiness = ReturnType<typeof createWorkerReadiness>;

export default createWorkerReadiness;
