import escapeXml from './escape-xml';

describe('escapeXml', () => {
  it('escapes what ends an element or an attribute', () => {
    expect(escapeXml('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('leaves other text alone', () => {
    expect(escapeXml('C:\\Program Files\\node.exe')).toBe('C:\\Program Files\\node.exe');
  });
});
