import communicationRegistry from './communication.json';

interface RegistryEntry {
  js: { path: string };
}

const registry: Record<string, RegistryEntry> = communicationRegistry;

export const isRegistered = (type: string): boolean => type in registry;

export const getRegisteredPath = (type: string | undefined): string => {
  const entry = type === undefined ? undefined : registry[type];

  if (!entry) {
    throw new Error(`Unknown communication type: ${type}`);
  }

  return entry.js.path;
};
