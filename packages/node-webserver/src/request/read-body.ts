import type { Request } from 'express';

/** the body of a request as text, which is rejected once it grows beyond the limit */
const readBody = (request: Request, limit: number) =>
  new Promise<string>((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;

    request.on('data', (part: Buffer) => {
      size += part.length;
      if (size > limit) {
        request.destroy();
        reject(new Error(`The body is larger than ${limit} bytes.`));
        return;
      }
      parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    request.on('error', reject);
  });

export default readBody;
