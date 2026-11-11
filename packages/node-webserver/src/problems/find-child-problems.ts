import type { ConfigurationProblem, ServerConfig } from '../types';

const PLACEHOLDER = /%PORT%/i;

/**
 * The process is told its port by `%PORT%` in its arguments, which is replaced when no port is set. A `%PORT%` next to a port is not reported: the server writes the port it chose
 * into `proxyOptions.port` when the process starts, so a server that runs already looks like one with a port.
 */
const findChildProblems = ({ childOptions, proxyOptions }: ServerConfig, server: string): ConfigurationProblem[] => {
  const args = childOptions?.args;

  if (!Array.isArray(args) || proxyOptions?.port || args.some((arg) => PLACEHOLDER.test(arg))) return [];

  return [{ severity: 'error', server, setting: 'childOptions.args', message: 'needs %PORT% to tell the process its port, or proxyOptions.port to be set' }];
};

export default findChildProblems;
