/**
 * The wire format of the channel between the server and its workers.
 *
 * A frame is: `u32 length of the rest | u8 body kind | u32 length of the metadata | metadata | body`
 * The metadata is the message as JSON without the body, which V8 handles fastest for small objects. The body travels as raw bytes,
 * so binary content is neither base64 encoded nor escaped, and the receiver gets it without parsing a string.
 */

/** an event may carry a body, in the frame it is separated from the rest of the event */
export interface WireMessage {
  type: string;
  requestId: string;
  event?: { body?: Buffer | string | null; [key: string]: unknown };
}

const BodyKind = {
  /** the event has no body */
  none: 0,
  /** the body is null, the end of a streamed response */
  end: 1,
  /** the body was a buffer and is received as one */
  bytes: 2,
  /** the body was a string and is received as one */
  text: 3,
} as const;

const fixedLength = 4 + 1 + 4;

const getBodyKind = (body: Buffer | string | null | undefined) => {
  if (body === undefined) return BodyKind.none;
  if (body === null) return BodyKind.end;
  return typeof body === 'string' ? BodyKind.text : BodyKind.bytes;
};

/** the frame of the message as the parts to write, the body is not copied */
export function encodeMessage({ event, ...message }: WireMessage): Buffer[] {
  const { body, ...rest } = event ?? {};
  const metadata = JSON.stringify(event === undefined ? message : { ...message, event: rest });
  const metadataLength = Buffer.byteLength(metadata);
  const bodyBytes = typeof body === 'string' ? Buffer.from(body) : body ?? undefined;
  const bodyLength = bodyBytes?.length ?? 0;

  const head = Buffer.allocUnsafe(fixedLength + metadataLength);
  head.writeUInt32LE(1 + 4 + metadataLength + bodyLength, 0);
  head.writeUInt8(getBodyKind(body), 4);
  head.writeUInt32LE(metadataLength, 5);
  head.write(metadata, fixedLength);

  return bodyLength > 0 ? [head, bodyBytes] : [head];
}

/** Turns the chunks read from a stream into the messages that were encoded, whatever the way the stream split them. */
export class FrameDecoder<T extends WireMessage> {
  /** what was received of the frame that is not complete yet, in the pieces it came in */
  private chunks: Buffer[] = [];
  private size = 0;
  /** how many bytes the frame in progress has, once known */
  private needed = 0;

  constructor(private readonly onMessage: (message: T) => void) {}

  /** throws when a frame cannot be understood, the stream is not to be trusted after that */
  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.size += chunk.length;

    if (this.size < this.needed) {
      return;
    }

    // a frame that came in many chunks is put together once, not each time a chunk arrives
    const buffer = this.chunks.length === 1 ? chunk : Buffer.concat(this.chunks, this.size);
    let offset = 0;
    this.needed = 0;

    while (buffer.length - offset >= 4) {
      const frameLength = buffer.readUInt32LE(offset);
      if (buffer.length - offset - 4 < frameLength) {
        this.needed = 4 + frameLength;
        break;
      }
      this.onMessage(this.decode(buffer.subarray(offset + 4, offset + 4 + frameLength)));
      offset += 4 + frameLength;
    }

    const rest = buffer.subarray(offset);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.size = rest.length;
  }

  private decode(frame: Buffer): T {
    const kind = frame.readUInt8(0);
    const metadataLength = frame.readUInt32LE(1);
    const bodyStart = 5 + metadataLength;

    if (bodyStart > frame.length) {
      throw new Error('The metadata of a frame is longer than the frame.');
    }

    const message = JSON.parse(frame.toString('utf8', 5, bodyStart));

    if (kind === BodyKind.end) message.event.body = null;
    if (kind === BodyKind.bytes) message.event.body = frame.subarray(bodyStart);
    if (kind === BodyKind.text) message.event.body = frame.toString('utf8', bodyStart);

    return message;
  }
}
