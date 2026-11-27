import { StringDecoder } from 'string_decoder';
import { MAX_CHILD_LINE_LENGTH } from '../constants';

/** a `\r` ends a line too, as of a progress bar: in the console it would write over what is in front of the line */
const LINE_BREAK = /\r\n?|\n/;

/**
 * Puts the pieces that are read from a stream together to whole lines, for `onLine`. Blank lines are left out. A line that is longer than `maxLength` comes in pieces of that
 * length, so that one that never ends does not fill the memory. `end` hands over what has no line break after it.
 */
const createLineSplitter = (onLine: (line: string) => void, maxLength = MAX_CHILD_LINE_LENGTH) => {
  // a character of several bytes can be split between two pieces
  const decoder = new StringDecoder('utf8');
  let unfinished = '';

  /** hands over the pieces of a line that are over the limit, and returns the rest of it */
  const cut = (line: string) => {
    let rest = line;
    while (rest.length > maxLength) {
      onLine(rest.slice(0, maxLength));
      rest = rest.slice(maxLength);
    }
    return rest;
  };

  const complete = (line: string) => {
    const text = cut(line).trimEnd();
    if (text) onLine(text);
  };

  return {
    write: (data: Buffer | string) => {
      // only the new piece is searched, so that a line that comes in many small ones is not gone through again with each of them
      const [first, ...others] = decoder.write(data).split(LINE_BREAK);
      const lines = [unfinished + first, ...others];
      const last = lines.pop() ?? '';
      lines.forEach(complete);
      unfinished = cut(last);
    },
    end: () => {
      complete(unfinished + decoder.end());
      unfinished = '';
    },
  };
};

export default createLineSplitter;
