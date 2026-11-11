import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import fs from 'fs';
import { resolve } from 'path';
import { PACKAGE_ROOT } from '../constants';

let ajv: Ajv | undefined;

const createAjv = () => {
  const instance = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  // the settings that take a function in a JS or TS configuration, which JSON has no value for
  instance.addKeyword({ keyword: 'function', validate: (_schema: unknown, data: unknown) => typeof data === 'function' });
  instance.addSchema(JSON.parse(fs.readFileSync(resolve(PACKAGE_ROOT, 'configuration.schema.json'), 'utf8')), 'configuration');

  return instance;
};

/** the validator of the whole configuration (`#`) or of one server (`#/definitions/server`) by the published schema, compiled once */
const getSchemaValidator = (reference = ''): ValidateFunction => {
  ajv ??= createAjv();
  const validate = ajv.getSchema(`configuration#${reference}`);

  if (!validate) {
    throw new Error(`The configuration schema has no ${reference || 'root'}.`);
  }

  return validate;
};

export default getSchemaValidator;
