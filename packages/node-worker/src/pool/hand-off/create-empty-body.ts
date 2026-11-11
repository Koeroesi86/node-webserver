import { Readable } from 'stream';

/** the body of a request that has none */
export default function createEmptyBody() {
  return new Readable({
    read() {
      // eslint-disable-next-line no-restricted-syntax -- pushing null is how a readable ends
      this.push(null);
    },
  });
}
