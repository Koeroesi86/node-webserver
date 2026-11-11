/**
 * The time a response may stay without progress. One timer for the whole response, that looks again when it fires whether there was progress since:
 * every sign of progress moves the deadline forward, which only costs a number, not a timer. Without a limit it does nothing.
 */
const createResponseTimeout = (limit: number | undefined, onTimeout: () => void) => {
  let timer: NodeJS.Timeout | undefined;
  /** when the response runs out of time */
  let deadline = 0;

  const check = () => {
    const remaining = deadline - Date.now();

    if (remaining > 0) {
      timer = setTimeout(check, remaining);
      return;
    }

    onTimeout();
  };

  return {
    arm: () => {
      if (!limit) return;

      deadline = Date.now() + limit;
      // after the clear the handle is still set, so no new timer starts
      timer ??= setTimeout(check, limit);
    },
    clear: () => clearTimeout(timer),
  };
};

export default createResponseTimeout;
