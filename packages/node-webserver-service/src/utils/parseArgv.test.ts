import parseArgv from './parseArgv';

describe('parseArgv', () => {
  it('keeps the executable and the script under their indexes', () => {
    expect(parseArgv(['node', 'script.js'])).toEqual({ 0: 'node', 1: 'script.js' });
  });

  it('reads a value after an equals sign', () => {
    expect(parseArgv(['node', 'script.js', '--port=8080'])).toMatchObject({ port: '8080' });
  });

  it('reads a value after a space', () => {
    expect(parseArgv(['node', 'script.js', '--config', '/etc/nws/config.js'])).toMatchObject({ config: '/etc/nws/config.js' });
  });

  it('reads a flag without a value as true', () => {
    expect(parseArgv(['node', 'script.js', '--verbose'])).toMatchObject({ verbose: true });
    expect(parseArgv(['node', 'script.js', '--verbose', '--port', '1'])).toMatchObject({ verbose: true, port: '1' });
  });

  it('accepts single dash names and quoted values', () => {
    expect(parseArgv(['node', 'script.js', '-p', '1', '--path="/a/b"'])).toMatchObject({ p: '1', path: '/a/b' });
  });

  it('does not lose the option after a value that was separated by a space', () => {
    expect(parseArgv(['node', 'script.js', '--a', '1', '--b', '2', '--c'])).toMatchObject({ a: '1', b: '2', c: true });
  });

  it('keeps every character of a value, like the underscores of a temporary folder', () => {
    const folder = '/var/folders/36/tjdph2t_9snz9_/T/config file+1~.js';

    expect(parseArgv(['node', 'script.js', '--configuration', folder])).toMatchObject({ configuration: folder });
    expect(parseArgv(['node', 'script.js', `--configuration=${folder}`])).toMatchObject({ configuration: folder });
  });

  it('reads an option with an underscore in its name', () => {
    expect(parseArgv(['node', 'script.js', '--my_flag'])).toMatchObject({ my_flag: true });
  });

  it('ignores arguments that are not options', () => {
    expect(parseArgv(['node', 'script.js', 'stray'])).toEqual({ 0: 'node', 1: 'script.js' });
  });

  it('reads process.argv by default', () => {
    const argv = process.argv;
    process.argv = ['node', 'script.js', '--from-process', 'yes'];

    try {
      expect(parseArgv()).toMatchObject({ 'from-process': 'yes' });
    } finally {
      process.argv = argv;
    }
  });
});
