import createLineSplitter from './create-line-splitter';
import { MAX_CHILD_LINE_LENGTH } from '../constants';

describe('createLineSplitter', () => {
  const split = (maxLength?: number) => {
    const onLine = jest.fn();
    const splitter = createLineSplitter(onLine, maxLength);
    return { ...splitter, lines: () => onLine.mock.calls.map(([line]) => line) };
  };

  it('hands over every line of a piece on its own, with its indentation', () => {
    const { write, lines } = split();

    write(Buffer.from('Error: broken\n    at app.js:1 \n'));

    expect(lines()).toEqual(['Error: broken', '    at app.js:1']);
  });

  it('waits for the rest of a line that comes in several pieces', () => {
    const { write, lines } = split();

    write('lis');
    write('ten');
    expect(lines()).toEqual([]);
    write('ing\nne');
    write('xt\n');

    expect(lines()).toEqual(['listening', 'next']);
  });

  it('ends a line at a carriage return too, also when the line feed after it comes later', () => {
    const { write, lines } = split();

    write('10%\r20%\rdone\r');
    write('\nwindows\r\n');

    expect(lines()).toEqual(['10%', '20%', 'done', 'windows']);
  });

  it('leaves blank lines out', () => {
    const { write, end, lines } = split();

    write('\n  \none\n\n');
    end();

    expect(lines()).toEqual(['one']);
  });

  it('hands over what has no line break after it once the output ends, only once', () => {
    const { write, end, lines } = split();

    write('one\nlast words');
    end();
    end();

    expect(lines()).toEqual(['one', 'last words']);
  });

  it('keeps a character together that is split between two pieces, and does not lose half of one at the end', () => {
    const { write, end, lines } = split();
    const text = Buffer.from('ő\nő');

    write(text.subarray(0, 1));
    write(text.subarray(1, text.length - 1));
    end();

    expect(lines()).toEqual(['ő', '\ufffd']);
  });

  it('cuts a line that never ends once it is over the limit', () => {
    const { write, end, lines } = split(4);

    write('abcd');
    expect(lines()).toEqual([]);
    write('efghij');
    expect(lines()).toEqual(['abcd', 'efgh']);
    end();

    expect(lines()).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('cuts a line that is over the limit but has an end', () => {
    const { write, lines } = split(4);

    write('abcdefghij\nkl\n');

    expect(lines()).toEqual(['abcd', 'efgh', 'ij', 'kl']);
  });

  it('has a limit unless it is given one', () => {
    const { write, lines } = split();

    write('a'.repeat(MAX_CHILD_LINE_LENGTH + 1));

    expect(lines()).toEqual(['a'.repeat(MAX_CHILD_LINE_LENGTH)]);
  });
});
