import { parseArgs } from 'node:util';

interface ServiceArguments {
  add: boolean;
  remove: boolean;
  run: boolean;
  user: boolean;
  configuration?: string;
}

const parseArguments = (args: string[]): ServiceArguments => {
  const { values } = parseArgs({
    args,
    options: {
      add: { type: 'boolean', default: false },
      remove: { type: 'boolean', default: false },
      run: { type: 'boolean', default: false },
      user: { type: 'boolean', default: false },
      configuration: { type: 'string' },
    },
  });

  return { add: values.add, remove: values.remove, run: values.run, user: values.user, configuration: values.configuration };
};

export default parseArguments;
