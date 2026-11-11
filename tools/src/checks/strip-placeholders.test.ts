import { stripPlaceholders } from './strip-placeholders';

describe('stripPlaceholders', () => {
  it('leaves nothing of a comment and an empty bullet', () => {
    expect(stripPlaceholders('<!-- a\nmultiline comment -->\n\n-\n')).toBe('');
  });

  it('keeps what a person wrote, also in a bullet', () => {
    expect(stripPlaceholders('<!-- c -->\n- Adds a thing\n')).toBe('- Adds a thing');
  });

  it('drops a comment that is not closed and the text after it', () => {
    expect(stripPlaceholders('a <!-- b <!-- c')).toBe('a');
  });
});
