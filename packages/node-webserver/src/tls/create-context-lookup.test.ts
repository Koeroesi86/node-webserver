import tls from 'tls';
import createContextLookup from './create-context-lookup';

describe('createContextLookup', () => {
  const exact = tls.createSecureContext();
  const wildcard = tls.createSecureContext();
  const other = tls.createSecureContext();

  it('finds an exact name, ignoring case', () => {
    expect(createContextLookup([{ hostname: 'a.example.com', secureContext: exact }])('A.Example.com')).toBe(exact);
  });

  it('finds a wildcard host for one label only', () => {
    const lookup = createContextLookup([{ hostname: '*.example.com', secureContext: wildcard }]);

    expect(lookup('a.example.com')).toBe(wildcard);
    expect(lookup('a.b.example.com')).toBeUndefined();
    expect(lookup('example.com')).toBeUndefined();
  });

  it('prefers an exact name over a wildcard, and the first wildcard in the order of the configuration', () => {
    const lookup = createContextLookup([
      { hostname: '*.example.com', secureContext: wildcard },
      { hostname: 'a.*.com', secureContext: other },
      { hostname: 'a.example.com', secureContext: exact },
    ]);

    expect(lookup('a.example.com')).toBe(exact);
    expect(lookup('b.example.com')).toBe(wildcard);
    expect(lookup('a.test.com')).toBe(other);
  });

  it('skips hosts without a certificate and finds nothing for an unknown name', () => {
    const lookup = createContextLookup([{ hostname: '*.example.com', secureContext: undefined }]);

    expect(lookup('a.example.com')).toBeUndefined();
    expect(lookup('')).toBeUndefined();
  });
});
