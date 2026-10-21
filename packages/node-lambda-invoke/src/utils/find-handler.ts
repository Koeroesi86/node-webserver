import type { LambdaHandler } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;

const isHandler = (value: unknown): value is LambdaHandler => typeof value === 'function';

/** the handler found by walking down `names` from `root`, and what holds it */
const lookUp = (root: unknown, names: string[]) => {
  const { current, parent } = names.reduce<{ current: unknown; parent: unknown }>(
    ({ current: holder }, name) => ({ current: isRecord(holder) ? holder[name] : undefined, parent: holder }),
    { current: root, parent: undefined }
  );

  return isHandler(current) ? { handler: current, thisArg: parent } : undefined;
};

/**
 * The handler of a loaded module: `handler`, or a nested one like `controllers.users.get`, as an export of the module.
 * A CommonJS module comes as its `default` when it was loaded as an ES module, so that is looked into as well.
 * The handler is called on what holds it, as on AWS.
 */
const findHandler = (namespace: unknown, handlerKey: string) => {
  const names = handlerKey.split('.');

  return lookUp(namespace, names) ?? lookUp(isRecord(namespace) ? namespace.default : undefined, names);
};

export default findHandler;
