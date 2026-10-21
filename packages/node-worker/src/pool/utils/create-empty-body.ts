import { Readable } from 'stream';

/** the body of a request that has none */
export default function createEmptyBody() {
  return new Readable({
    read() {
      this.push(null);
    },
  });
}
