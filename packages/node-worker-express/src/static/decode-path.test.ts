import decodePath from './decode-path';

describe('decodePath', () => {
  it.each([
    ['/a%20b.txt', '/a b.txt'],
    ['/100%25.txt', '/100%.txt'],
    ['/%C3%A1rv%C3%ADzt%C5%B1r%C5%91.txt', '/árvíztűrő.txt'],
    ['/plain.txt', '/plain.txt'],
    ['/%2e%2e/secret.txt', '/../secret.txt'],
  ])('decodes %s', (input, expected) => {
    expect(decodePath(input)).toBe(expected);
  });

  it.each(['/%zz', '/100%', '/%E0%A4%A'])('gives undefined for the malformed %s', (input) => {
    expect(decodePath(input)).toBeUndefined();
  });
});
