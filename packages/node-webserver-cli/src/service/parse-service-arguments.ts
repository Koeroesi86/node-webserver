import { parseArgs } from 'node:util';
import type { ServiceArguments } from '../types';

/** the arguments after `service` */
const parseServiceArguments = (args: string[]): ServiceArguments => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      user: { type: 'boolean', default: false },
      config: { type: 'string' },
    },
  });

  return { action: positionals[0], user: values.user, config: values.config };
};

export default parseServiceArguments;
