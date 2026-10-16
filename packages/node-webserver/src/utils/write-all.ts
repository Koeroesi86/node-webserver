import { writeSync } from 'fs';

/** Writes the whole chunk at the position, blocking, also when the disk takes it in parts. */
const writeAll = (fd: number, data: Buffer, position: number) => {
  let done = 0;
  while (done < data.length) {
    done += writeSync(fd, data, done, data.length - done, position + done);
  }
};

export default writeAll;
