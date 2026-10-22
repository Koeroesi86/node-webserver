import path from 'path';
import applyAcmeFiles from './apply-acme-files';
import getAcmeFiles from './get-acme-files';

const acme = { email: 'a@example.com', storagePath: path.join('/var', 'nws') };

describe('applyAcmeFiles', () => {
  it('sets the files of a server with acme, without changing the definition', () => {
    const definition = { hostname: 'a.example.com', protocol: 'https', acme };

    expect(applyAcmeFiles(definition)).toEqual({ ...definition, ...getAcmeFiles(definition) });
    expect(definition).not.toHaveProperty('key');
  });

  it('leaves the others, and the ones whose settings are not usable, as they are', () => {
    const plain = { hostname: 'a.example.com', protocol: 'https', key: '/k.pem', cert: '/c.pem' };
    const unusable = { hostname: 'a.example.com', protocol: 'https', acme: { email: 'a@example.com' } } as unknown as Parameters<typeof applyAcmeFiles>[0];

    expect(applyAcmeFiles(plain)).toBe(plain);
    expect(applyAcmeFiles(unusable)).toBe(unusable);
  });
});
