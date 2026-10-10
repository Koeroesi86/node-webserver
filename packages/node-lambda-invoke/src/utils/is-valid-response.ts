import type ResponseEvent from '../classes/ResponseEvent';

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const isOptional = (value: unknown, isValid: (value: unknown) => boolean) => value === undefined || value === null || isValid(value);

const isObject = (value: unknown) => typeof value === 'object';

/** a response that can be written: AWS answers anything else with 502, as a malformed proxy response */
const isValidResponse = (response: ResponseEvent): response is ResponseEvent & { statusCode: number } => {
  const { statusCode, headers, multiValueHeaders, cookies, body } = response;

  return (
    statusCode !== undefined &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599 &&
    isOptional(headers, isObject) &&
    isOptional(multiValueHeaders, (value) => isObject(value) && Object.values(value as object).every(isStringArray)) &&
    isOptional(cookies, isStringArray) &&
    isOptional(body, (value) => typeof value === 'string')
  );
};

export default isValidResponse;
