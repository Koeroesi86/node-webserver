import { RELEASE_CHECK_INTERVAL, RELEASE_MAX_GAP, RELEASE_SETTLE_LOOKS } from '../constants';

interface Options {
  /** the versions the server runs */
  running: string;
  /** the versions that are installed now, throws while they cannot be read */
  read: () => string;
  /** called for other versions, once they stayed the same for a while */
  onChange: () => void;
  interval?: number;
}

/**
 * Looks at the installed versions of the server again and again, which works with every way to install it, links included, where watching files depends on how an update writes them.
 * Other versions are reported once they were the same for a few looks, as an update writes one package after the other, and again after ever longer gaps while they stay: the update
 * may not have been complete, or its check may have failed. Returns what stops it.
 */
const watchRelease = ({ running, read, onChange, interval = RELEASE_CHECK_INTERVAL }: Options): (() => void) => {
  let seen = running;
  /** how many looks found the same since the first one */
  let same = 0;
  let next = RELEASE_SETTLE_LOOKS;

  const look = () => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };

  const timer = setInterval(() => {
    const found = look();
    if (found === undefined || found !== seen) {
      seen = found ?? running;
      same = 0;
      next = RELEASE_SETTLE_LOOKS;
      return;
    }
    if (found === running) return;

    same += 1;
    if (same < next) return;
    next += Math.min(next, RELEASE_MAX_GAP);
    onChange();
  }, interval);
  // the look must not keep the process running
  timer.unref();

  return () => clearInterval(timer);
};

export default watchRelease;
