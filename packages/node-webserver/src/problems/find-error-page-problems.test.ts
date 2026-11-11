import fs from 'fs';
import os from 'os';
import path from 'path';
import findErrorPageProblems from './find-error-page-problems';

describe('findErrorPageProblems', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'error-page-problems-'));
  const page = path.join(folder, '404.html');

  beforeAll(() => fs.writeFileSync(page, 'x'));
  afterAll(() => fs.rmSync(folder, { recursive: true }));

  it('finds nothing in pages that are files, nor without pages', () => {
    expect(findErrorPageProblems({}, 's')).toEqual([]);
    expect(findErrorPageProblems({ errorPages: { 404: page, 503: page } }, 's')).toEqual([]);
  });

  it('names the status of a page that is not a file', () => {
    expect(findErrorPageProblems({ errorPages: { 404: page, 502: path.join(folder, 'missing.html') } }, 's')).toEqual([
      expect.objectContaining({ severity: 'error', server: 's', setting: 'errorPages.502', message: expect.stringContaining('is not a file') }),
    ]);
  });

  it.each(['200', '404x', '600', 'not-found'])('refuses %s, which is not a status code of an error', (status) => {
    expect(findErrorPageProblems({ errorPages: { [status]: page } }, 's')).toEqual([expect.objectContaining({ setting: `errorPages.${status}` })]);
  });
});
