import varyOnEncoding from './vary-on-encoding';

describe('varyOnEncoding', () => {
  it.each([
    [true, '', { Vary: 'Accept-Encoding' }],
    [true, 'Origin', { Vary: 'Origin, Accept-Encoding' }],
    [true, 'Origin, accept-encoding', {}],
    [true, 'Accept-Encoding, Origin', {}],
    [true, '*', {}],
    [true, 'Accept-Encoding-Other', { Vary: 'Accept-Encoding-Other, Accept-Encoding' }],
    [false, '', {}],
    [false, 'Origin', {}],
  ])('for compressible %j and Vary %j gives %j', (isCompressible, vary, expected) => {
    expect(varyOnEncoding(isCompressible, vary)).toEqual(expected);
  });
});
