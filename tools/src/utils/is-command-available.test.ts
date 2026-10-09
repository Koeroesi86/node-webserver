import { isCommandAvailable } from './is-command-available';

describe('isCommandAvailable', () => {
  it('is true for a command that succeeds', () => {
    expect(isCommandAvailable('node', ['--version'])).toBe(true);
  });

  it('is false for a command that fails', () => {
    expect(isCommandAvailable('node', ['--no-such-option-at-all'])).toBe(false);
  });

  it('is false for a command that is not installed', () => {
    expect(isCommandAvailable('no-such-command-installed', [])).toBe(false);
  });
});
