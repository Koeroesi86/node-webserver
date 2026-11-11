import { requestEndpoint } from './request-endpoint';

/** whether the server answers on the port without an error status */
export const isServerUp = async (port: string, host = 'web.localhost') => {
  const status = await requestEndpoint(port, { host, path: '/' }, 2000);

  return status !== undefined && status < 400;
};
