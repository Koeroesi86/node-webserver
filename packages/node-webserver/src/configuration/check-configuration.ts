import type { ConfigurationProblem, Configuration } from '../types';
import inspectConfiguration from './inspect-configuration';

/**
 * Everything wrong with a configuration and the server files it names, as a start or a reload would find it, without listening or starting a worker, a lambda or a process.
 * The server files are loaded, which runs them. A file that cannot be loaded is a problem of its own and the others are still checked.
 */
const checkConfiguration = (configuration: Partial<Configuration>): ConfigurationProblem[] => inspectConfiguration(configuration).problems;

export default checkConfiguration;
