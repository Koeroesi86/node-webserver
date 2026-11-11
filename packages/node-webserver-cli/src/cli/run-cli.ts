import { manageService } from '../service';
import parseArgv from './parse-argv';
import { resolveConfigurationPath } from '../utils';
import runServer from './run-server';

/** `service ...` manages the service of a configuration, anything else runs the server of it */
const runCli = async (argv: string[], environment: string | undefined): Promise<void> => {
  const [, , command, ...rest] = argv;

  if (command === 'service') return manageService(rest, environment);

  const { config, check } = parseArgv(argv);

  return runServer(resolveConfigurationPath(typeof config === 'string' ? config : undefined, environment), Boolean(check));
};

export default runCli;
