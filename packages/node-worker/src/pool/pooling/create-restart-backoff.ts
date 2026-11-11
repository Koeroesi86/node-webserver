export interface RestartBackoffOptions {
  /** how long a worker has to be up to count as healthy, in milliseconds */
  minUptime: number;
  base: number;
  max: number;
}

/** Tracks the workers that crashed in a row per path, and when another one may be started. */
const createRestartBackoff = ({ base, max }: RestartBackoffOptions) => {
  const failures = new Map<string, { count: number; retryAt: number }>();

  /** how long a worker for the path may not be started, 0 when it may */
  const getBackoff = (workerPath: string) => Math.max(0, (failures.get(workerPath)?.retryAt ?? 0) - Date.now());

  return {
    getBackoff,
    /** a second crash in a row, and every one after it, holds back the next start for longer */
    recordFailure: (workerPath: string) => {
      const count = (failures.get(workerPath)?.count ?? 0) + 1;
      const delay = count < 2 ? 0 : Math.min(max, base * 2 ** (count - 2));
      failures.set(workerPath, { count, retryAt: Date.now() + delay });
    },
    clear: (workerPath: string) => failures.delete(workerPath),
    /** the paths whose workers crashed in a row, with the number of crashes and the time until another one is started */
    getStats: () =>
      Object.fromEntries(Array.from(failures.entries()).map(([workerPath, { count }]) => [workerPath, { crashes: count, retryInMs: getBackoff(workerPath) }])),
  };
};

export default createRestartBackoff;
