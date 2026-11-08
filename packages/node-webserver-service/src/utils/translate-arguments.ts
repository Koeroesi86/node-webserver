import parseArguments from './parse-arguments';

/** the arguments of nws-service as the ones of nws-cli: --add and --remove are `service add` and `service remove`, --run is the server itself */
const translateArguments = (args: string[]): string[] => {
  const { add, remove, run, user, configuration } = parseArguments(args);
  const config = configuration ? ['--config', configuration] : [];

  if (user && !add && !remove) {
    throw new Error('--user goes with --add or --remove.');
  }

  if (run) return config;

  // without an action nws-cli prints its usage
  return ['service', ...(add ? ['add'] : []), ...(remove && !add ? ['remove'] : []), ...(user ? ['--user'] : []), ...config];
};

export default translateArguments;
