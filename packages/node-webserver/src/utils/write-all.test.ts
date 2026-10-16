const writeSync = jest.fn();
jest.mock('fs', () => ({ writeSync }));

import writeAll from './write-all';

describe('writeAll', () => {
  it('writes the rest of a chunk that the disk took only a part of, at the place it belongs', () => {
    const data = Buffer.from('abcdef');
    writeSync.mockReturnValueOnce(2).mockReturnValueOnce(4);

    writeAll(7, data, 10);

    expect(writeSync).toHaveBeenNthCalledWith(1, 7, data, 0, 6, 10);
    expect(writeSync).toHaveBeenNthCalledWith(2, 7, data, 2, 4, 12);
    expect(writeSync).toHaveBeenCalledTimes(2);
  });

  it('writes nothing for an empty chunk', () => {
    writeSync.mockClear();

    writeAll(7, Buffer.alloc(0), 0);

    expect(writeSync).not.toHaveBeenCalled();
  });
});
