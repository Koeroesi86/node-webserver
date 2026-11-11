import isPublicAddress from './is-public-address';

describe('isPublicAddress', () => {
  it.each(['203.0.113.7', '8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('takes %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    'localhost',
    '',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
