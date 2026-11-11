import type { ErrorObject, ValidateFunction } from 'ajv';
import type { ConfigurationProblem } from '../types';

const joinSetting = (path: string, segment: string) => (/^\d+$/.test(segment) ? `${path}[${segment}]` : [path, segment].filter(Boolean).join('.'));

const toSetting = (instancePath: string) =>
  instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce(joinSetting, '');

const isUnion = ({ keyword }: ErrorObject) => keyword === 'anyOf' || keyword === 'oneOf';

/** the errors of the branches of a union say why the value is none of its things: the errors at the place of an `anyOf` or `oneOf` that are not its own */
const isBranch = (error: ErrorObject, errors: ErrorObject[]) =>
  !isUnion(error) && errors.some((other) => isUnion(other) && other.instancePath === error.instancePath);

/** what an error is about and says, in the words of the configuration instead of the ones of the schema */
const describers: Record<string, (error: ErrorObject) => { setting: string; message: string }> = {
  additionalProperties: ({ instancePath, params }) => ({
    setting: joinSetting(toSetting(instancePath), String(params.additionalProperty)),
    message: 'is not a setting',
  }),
  required: ({ instancePath, params }) => ({ setting: joinSetting(toSetting(instancePath), String(params.missingProperty)), message: 'is required' }),
  enum: ({ instancePath, params }) => ({ setting: toSetting(instancePath), message: `must be one of: ${params.allowedValues.join(', ')}` }),
  const: ({ instancePath, params }) => ({ setting: toSetting(instancePath), message: `must be ${JSON.stringify(params.allowedValue)}` }),
  function: ({ instancePath }) => ({ setting: toSetting(instancePath), message: 'must be a function' }),
};

const describe = (error: ErrorObject) =>
  describers[error.keyword]?.(error) ?? { setting: toSetting(error.instancePath), message: error.message ?? 'is not valid' };

/** the branches of an `anyOf` or `oneOf` at one place are one problem: the value is none of the things it could be */
/** what a branch says, with the setting it is about when that is one inside the place of the union (a property a branch requires) */
const describeBranch = (error: ErrorObject) => {
  const { setting, message } = describe(error);
  const inner = setting.slice(toSetting(error.instancePath).length).replace(/^\./, '');

  return inner ? `${inner} ${message}` : message;
};

/** the branches of a union at one place are one problem: the value is none of the things it could be */
const mergeBranches = (errors: ErrorObject[]) =>
  [...new Set(errors.filter((error) => isBranch(error, errors)).map(({ instancePath }) => instancePath))].map((instancePath) => ({
    setting: toSetting(instancePath),
    message: errors
      .filter((error) => isBranch(error, errors) && error.instancePath === instancePath)
      .map(describeBranch)
      .sort()
      .join(', or '),
  }));

/** `if` and the keywords of a union only say that a branch failed, which the errors of the branch say better */
const isSummary = (error: ErrorObject, errors: ErrorObject[]) =>
  error.keyword === 'if' || (isUnion(error) && errors.some((other) => isBranch(other, errors) && other.instancePath === error.instancePath));

/** every way the data differs from the schema, not only the first, with the server it is in when it is the definition of one */
const findSchemaProblems = (validate: ValidateFunction, data: unknown, server?: string): ConfigurationProblem[] => {
  validate(data);
  const errors = validate.errors ?? [];

  return [...errors.filter((error) => !isBranch(error, errors) && !isSummary(error, errors)).map(describe), ...mergeBranches(errors)].map(
    ({ setting, message }) => ({
      severity: 'error',
      server,
      setting: setting || '(whole)',
      message,
    })
  );
};

export default findSchemaProblems;
