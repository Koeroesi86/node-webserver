import renderDirectoryListing from './render-directory-listing';

describe('renderDirectoryListing', () => {
  it('lists folders first, then files by name', () => {
    const html = renderDirectoryListing('/a/', [
      { name: 'z.txt', isDirectory: false },
      { name: 'b', isDirectory: true },
      { name: 'a.txt', isDirectory: false },
    ]);

    expect(html.match(/href="([^"]+)"/g)).toEqual(['href="../"', 'href="b/"', 'href="a.txt"', 'href="z.txt"']);
  });

  it('escapes the names and the path, and encodes the links', () => {
    const html = renderDirectoryListing('/<x>/', [{ name: '"><script>.txt', isDirectory: false }]);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<x>');
    expect(html).toContain('href="%22%3E%3Cscript%3E.txt"');
    expect(html).toContain('&quot;&gt;&lt;script&gt;.txt');
  });

  it('has no link to a folder above the root', () => {
    expect(renderDirectoryListing('/', [])).not.toContain('../');
  });
});
