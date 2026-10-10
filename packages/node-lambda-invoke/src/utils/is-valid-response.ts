import type ResponseEvent from '../classes/ResponseEvent';

/** a response that can be written: AWS answers anything else with 502, as a malformed proxy response */
const isValidResponse = (response: ResponseEvent): response is ResponseEvent & { statusCode: number } => {
  const { statusCode, headers, body } = response;

  return (
    statusCode !== undefined &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599 &&
    (headers === undefined || headers === null || typeof headers === 'object') &&
    (body === undefined || body === null || typeof body === 'string')
  );
};

export default isValidResponse;
