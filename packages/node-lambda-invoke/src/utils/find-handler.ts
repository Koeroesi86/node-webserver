import type { LambdaHandler } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;

const isHandler = (value: unknown): value is LambdaHandler => typeof value === 'function';

/**
 * The handler of a loaded module: `handler`, or a nested one like `controllers.users.get`, as an export of the module.
 * A CommonJS module comes as its `default` when it was loaded as an ES module, so that is looked into as well.
 * The handler is called on what holds it, as on AWS.
 */
const findHandler = (namespace: unknown, handlerKey: string) => {
  const names = handlerKey.split('.');
  const roots = [namespace, isRecord(namespace) ? namespace.default : undefined];

  for (const root of roots) {
    let parent: unknown;
    let current: unknown = root;
    for (const name of names) {
      parent = current;
      current = isRecord(current) ? current[name] : undefined;
    }

    if (isHandler(current)) return { handler: current, thisArg: parent };
  }

  return undefined;
};

export default findHandler;
