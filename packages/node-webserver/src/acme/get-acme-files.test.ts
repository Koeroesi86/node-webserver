import path from 'path';
import getAcmeFiles from './get-acme-files';

const acme = { email: 'a@example.com', storagePath: path.join('/var', 'nws') };

describe('getAcmeFiles', () => {
  it('puts the key and the certificate in the folder of the host name', () => {
    expect(getAcmeFiles({ hostname: 'a.example.com', acme })).toEqual({
      key: path.join('/var', 'nws', 'a.example.com', 'privkey.pem'),
      cert: path.join('/var', 'nws', 'a.example.com', 'fullchain.pem'),
    });
  });

  it('keeps the files the server names', () => {
    expect(getAcmeFiles({ hostname: 'a.example.com', acme, key: '/k.pem', cert: '/c.pem' })).toEqual({ key: '/k.pem', cert: '/c.pem' });
  });
});
