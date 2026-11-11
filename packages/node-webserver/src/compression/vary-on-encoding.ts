import type { HeaderChanges } from '../types';

/** caches have to know that the answer depends on what the client accepts, also when this one is not compressed */
const varyOnEncoding = (isCompressible: boolean, vary: string): HeaderChanges => {
  if (!isCompressible || /(^|,)\s*(\*|accept-encoding)\s*(,|$)/i.test(vary)) return {};

  return { Vary: vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding' };
};

export default varyOnEncoding;
