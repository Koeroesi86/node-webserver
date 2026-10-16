import { BODYLESS_STATUSES } from '../constants';
import type { HeaderMap } from '../types';
import asString from './as-string';

/** a status that has a body, an answer that is not encoded yet, not a part of one (its range is of the bytes as they are) and that the origin does not ask to leave as it is */
const isOpenToEncoding = (statusCode: number, headers: HeaderMap) =>
  statusCode >= 200 &&
  !BODYLESS_STATUSES.includes(statusCode) &&
  headers['content-range'] === undefined &&
  (headers['content-encoding'] === undefined || headers['content-encoding'] === 'identity') &&
  !/(^|,)\s*no-transform\s*(,|$)/i.test(asString(headers['cache-control']));

export default isOpenToEncoding;
