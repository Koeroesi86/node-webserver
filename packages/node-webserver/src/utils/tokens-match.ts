import { createHash, timingSafeEqual } from 'crypto';

const digest = (text: string) => createHash('sha256').update(text).digest();

/** compares a token in constant time, its length included, as the digests are of the same size whatever was sent */
const tokensMatch = (sent: string, expected: string): boolean => timingSafeEqual(digest(sent), digest(expected));

export default tokensMatch;
