/**
 * the folders of the packages that hold functions, one per file, behind the `index.ts` of the folder: `utils/` for what belongs to no domain and one folder per domain
 * for the rest. A new domain folder is added here, so that its added files are held to the same layout rules.
 */
export const FUNCTION_FOLDERS = [
  'utils',
  // node-webserver
  'acme',
  'children',
  'compression',
  'configuration',
  'lifecycle',
  'observability',
  'problems',
  'proxy',
  'reload',
  'request',
  'routing',
  'tls',
  // node-worker-express
  'hand-off',
  'metrics',
  'static',
  'websocket',
  'worker',
  // node-lambda-invoke
  'event',
  'lambda',
  'response',
  // node-webserver-cli
  'cli',
  'service',
  'service-files',
];
