import { DEFAULT_PORTS } from '../constants';

function getURL(protocol: string, hostname: string, port?: number) {
  let displayedPort = port ? `:${port}` : '';

  if (DEFAULT_PORTS[protocol] === port) {
    displayedPort = '';
  }

  return `${protocol}://${hostname}${displayedPort}`;
}

export default getURL;
