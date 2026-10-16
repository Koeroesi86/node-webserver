import { formatWithOptions } from 'util';

/**
 * The lines for the console, which wait until the turn of the event loop is over and leave in one write. Every write is a system call on the thread that
 * serves the requests, and a request logs two lines. Lines of other code that writes to the console directly can come out before them, by at most that turn.
 */
const createConsoleBatcher = () => {
  let lines: string[] = [];
  let flushScheduled = false;

  function flush() {
    flushScheduled = false;
    if (lines.length === 0) return;

    const text = lines.join('\n');
    lines = [];
    console.log(text);
  }

  function log(args: unknown[]) {
    // formatted like console.log does it, with colors when the console is a terminal, as the lines are joined into a single string
    lines.push(formatWithOptions({ colors: Boolean(process.stdout.isTTY) }, ...args));

    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flush);
    }
  }

  return { log, flush };
};

export default createConsoleBatcher;
