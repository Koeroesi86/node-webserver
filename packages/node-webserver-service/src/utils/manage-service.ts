import { dirname } from 'path';
import { SERVICE_SCRIPT_PATH, USAGE } from '../constants';
import installService from './install-service';
import parseArguments from './parse-arguments';
import removeService from './remove-service';
import resolveConfigurationPath from './resolve-configuration-path';
import start from './start';
import validateServiceName from './validate-service-name';
import type { ServiceConfiguration, ServiceDefinition } from '../types';

const createDefinition = (configPath: string): ServiceDefinition => {
  const configuration: ServiceConfiguration = require(configPath);
  const name = validateServiceName(configuration.serviceName);

  return {
    name,
    displayName: configuration.serviceDisplayName || name,
    nodePath: process.execPath,
    scriptPath: SERVICE_SCRIPT_PATH,
    configPath,
    workingDirectory: dirname(configPath),
    user: configuration.serviceUser,
    logFolder: configuration.fileLogPath || undefined,
  };
};

const manageService = async (args: string[], environment: string | undefined = process.env.NODE_WEBSERVER_CONFIG): Promise<void> => {
  const { add, remove, run, configuration } = parseArguments(args);

  if (!add && !remove && !run) {
    console.info('\x1b[32m%s\x1b[0m', USAGE);
    return;
  }

  const configPath = resolveConfigurationPath(configuration, environment);

  if (run) return start(configPath);
  if (add) return installService(createDefinition(configPath));
  return removeService(createDefinition(configPath));
};

export default manageService;
