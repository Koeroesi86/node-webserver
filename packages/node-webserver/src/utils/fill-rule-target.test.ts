import fillRuleTarget from './fill-rule-target';

describe('fillRuleTarget', () => {
  it('puts the captures in for the placeholders, as many times as they are written', () => {
    expect(fillRuleTarget('/new/{id}/{id}?x={name}', { id: '7', name: 'a' })).toBe('/new/7/7?x=a');
  });

  it('leaves what the request wrote as it is, percent escapes included', () => {
    expect(fillRuleTarget('/{rest}', { rest: 'a%20b/c' })).toBe('/a%20b/c');
  });

  it('encodes the backslash and what is not printable ASCII, so that a capture cannot start another place', () => {
    expect(fillRuleTarget('/{rest}', { rest: '\\evil.com' })).toBe('/%5Cevil.com');
    expect(fillRuleTarget('/{rest}', { rest: 'á é ü' })).toBe('/%C3%A1%20%C3%A9%20%C3%BC');
  });

  it('puts nothing for a group that took no part in the match, or one that is not there, even a name of Object', () => {
    expect(fillRuleTarget('/a{opt}/{constructor}/{other}', {})).toBe('/a//');
    expect(fillRuleTarget('/a{opt}')).toBe('/a');
  });

  it('leaves braces that are not a placeholder', () => {
    expect(fillRuleTarget('/a{}/{ b }', {})).toBe('/a{}/{ b }');
  });
});
