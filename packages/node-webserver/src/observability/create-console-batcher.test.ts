import createConsoleBatcher from './create-console-batcher';

describe('createConsoleBatcher', () => {
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes nothing before the turn of the event loop is over', () => {
    createConsoleBatcher().log(['a']);

    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('writes the lines of a turn in one write, in order', async () => {
    const batcher = createConsoleBatcher();

    batcher.log(['a']);
    batcher.log(['b', 1]);
    await new Promise(setImmediate);

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith('a\nb 1');
  });

  it('puts the prefix in front of every line, after its placeholders are filled', () => {
    const batcher = createConsoleBatcher('[a] ');

    batcher.log(['%s is %i', 'one', 1]);
    batcher.log(['two']);
    batcher.flush();

    expect(consoleLog).toHaveBeenCalledWith('[a] one is 1\n[a] two');
  });

  it('writes the lines of the next turn in another write', async () => {
    const batcher = createConsoleBatcher();

    batcher.log(['a']);
    await new Promise(setImmediate);
    batcher.log(['b']);
    await new Promise(setImmediate);

    expect(consoleLog).toHaveBeenNthCalledWith(1, 'a');
    expect(consoleLog).toHaveBeenNthCalledWith(2, 'b');
  });

  it('writes what waits when flushed, and not again afterwards', async () => {
    const batcher = createConsoleBatcher();

    batcher.log(['a']);
    batcher.flush();
    await new Promise(setImmediate);
    batcher.flush();

    expect(consoleLog).toHaveBeenCalledTimes(1);
  });
});
