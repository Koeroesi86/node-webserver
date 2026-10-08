import type { PublishedRelease } from '../types/version';

/** the latest release on the registry, or undefined when the package was never published */
export const fetchPublishedRelease = async (name: string, registryUrl: string): Promise<PublishedRelease | undefined> => {
  const response = await fetch(`${registryUrl}/${name.replaceAll('/', '%2F')}/latest`);

  if (response.status === 404) return undefined;

  if (!response.ok) {
    throw new Error(`Failed to look up ${name} on ${registryUrl}: ${response.status} ${response.statusText}`);
  }

  const { version, gitHead }: PublishedRelease = JSON.parse(await response.text());

  return { version, gitHead };
};
