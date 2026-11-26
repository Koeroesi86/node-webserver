import fs from 'fs';
import os from 'os';
import path from 'path';
import getLoadFingerprint from './get-load-fingerprint';
import type { LoadedInstance } from '../types';

describe('getLoadFingerprint', () => {
  let folder: string;

  beforeEach(() => (folder = fs.mkdtempSync(path.join(os.tmpdir(), 'load-fingerprint-'))));
  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  const write = (name: string, content: string) => {
    const file = path.join(folder, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const server = (fingerprint: string, extra: object = {}) =>
    ({ source: 'server.js', instance: { hostname: 'a.localhost', protocol: 'https', ...extra }, fingerprint }) as unknown as LoadedInstance;

  it('is the same for servers that were loaded from the same', () => {
    expect(getLoadFingerprint([server('a')])).toBe(getLoadFingerprint([server('a')]));
  });

  it('changes with the fingerprint of a server', () => {
    expect(getLoadFingerprint([server('a')])).not.toBe(getLoadFingerprint([server('b')]));
  });

  it('names a server that is defined in the configuration by its host', () => {
    const inline = (hostname: string) => ({ source: {}, instance: { hostname }, fingerprint: 'a' }) as unknown as LoadedInstance;

    expect(getLoadFingerprint([inline('a.localhost')])).not.toBe(getLoadFingerprint([inline('b.localhost')]));
  });

  it.each(['key', 'cert', 'ca', 'errorPages', 'unknownHostPage'])('changes with the content of %s', (setting) => {
    const file = write(setting, 'before');
    const extra = setting === 'errorPages' ? { errorPages: { 404: file } } : { [setting]: file };
    const read = () => getLoadFingerprint([server('a', extra)], setting === 'unknownHostPage' ? file : undefined);
    const before = read();

    write(setting, 'after');

    expect(read()).not.toBe(before);
  });
});
