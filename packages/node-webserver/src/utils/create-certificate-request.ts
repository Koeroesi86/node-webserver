import { sign } from 'crypto';
import type { KeyObject } from 'crypto';

// node can make keys and sign, but not a certificate request, so the few DER structures of one (RFC 2986) are written out here
const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const OID = 0x06;
const UTF8_STRING = 0x0c;
const OCTET_STRING = 0x04;
const BIT_STRING = 0x03;
const ATTRIBUTES = 0xa0;
const DNS_NAME = 0x82;
/** a common name is at most 64 bytes long, longer names are in the alternative name only */
const MAX_COMMON_NAME = 64;

const encodeLength = (length: number) => {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = length > 0xff ? [length >> 8, length & 0xff] : [length];

  return Buffer.from([0x80 + bytes.length, ...bytes]);
};

const encode = (tag: number, ...parts: Buffer[]) => {
  const content = Buffer.concat(parts);

  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
};

/** the bytes of an arc of an object identifier, all but the last with the high bit set */
const base128 = (value: number, last = true): number[] => {
  const byte = (value % 0x80) + (last ? 0 : 0x80);

  return value < 0x80 ? [byte] : [...base128(Math.floor(value / 0x80), false), byte];
};

const oid = (dotted: string) => {
  const [first, second, ...rest] = dotted.split('.').map(Number);

  return encode(OID, Buffer.from([first * 40 + second, ...rest.flatMap((arc) => base128(arc))]));
};

const COMMON_NAME = oid('2.5.4.3');
const EXTENSION_REQUEST = oid('1.2.840.113549.1.9.14');
const SUBJECT_ALTERNATIVE_NAME = oid('2.5.29.17');
const ECDSA_WITH_SHA256 = oid('1.2.840.10045.4.3.2');

const subjectName = (hostname: string) =>
  encode(SEQUENCE, ...(hostname.length > MAX_COMMON_NAME ? [] : [encode(SET, encode(SEQUENCE, COMMON_NAME, encode(UTF8_STRING, Buffer.from(hostname))))]));

const extensionRequest = (hostname: string) =>
  encode(
    SEQUENCE,
    EXTENSION_REQUEST,
    encode(SET, encode(SEQUENCE, encode(SEQUENCE, SUBJECT_ALTERNATIVE_NAME, encode(OCTET_STRING, encode(SEQUENCE, encode(DNS_NAME, Buffer.from(hostname)))))))
  );

/** the DER of a certificate request for the host name, signed with the private key (an elliptic curve key, with SHA-256), which the ACME server turns into a certificate for the public key of it */
const createCertificateRequest = (hostname: string, privateKey: KeyObject, publicKey: KeyObject): Buffer => {
  const info = encode(
    SEQUENCE,
    encode(INTEGER, Buffer.from([0])),
    subjectName(hostname),
    publicKey.export({ type: 'spki', format: 'der' }),
    encode(ATTRIBUTES, extensionRequest(hostname))
  );
  const signature = sign('sha256', info, { key: privateKey, dsaEncoding: 'der' });

  return encode(SEQUENCE, info, encode(SEQUENCE, ECDSA_WITH_SHA256), encode(BIT_STRING, Buffer.from([0]), signature));
};

export default createCertificateRequest;
