import findMissingPaths from './find-missing-paths';
import type { ConfigurationProblem, ServerConfig } from '../types';

const problem = (server: string, setting: string, message: string): ConfigurationProblem => ({ severity: 'error', server, setting, message });

/** what the schema cannot say about `acme`: it belongs to an https server, a name the `http-01` challenge can prove, an https directory and a folder-safe name */
const findAcmeProblems = ({ protocol, hostname, acme }: ServerConfig, server: string): ConfigurationProblem[] => {
  if (!acme) return [];

  const { directory, directoryCa } = acme;

  return [
    ...(protocol === 'https' ? [] : [problem(server, 'acme', 'is for an https server')]),
    ...(hostname.includes('*')
      ? [problem(server, 'acme', 'cannot get a certificate for a host name with a wildcard: that needs the dns-01 challenge, which is not supported')]
      : []),
    ...(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(hostname) || hostname.includes('*')
      ? []
      : [problem(server, 'hostname', 'needs letters, digits, dots and hyphens only to get a certificate (an international name in its punycode form)')]),
    ...(directory !== undefined && !(URL.canParse(directory) && new URL(directory).protocol === 'https:')
      ? [problem(server, 'acme.directory', `is not an https URL: ${directory}`)]
      : []),
    ...findMissingPaths(server, [{ setting: 'acme.directoryCa', path: directoryCa, kind: 'file' }]),
  ];
};

export default findAcmeProblems;
