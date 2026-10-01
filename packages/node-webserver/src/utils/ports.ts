import fp from 'find-free-port';
import type { PortLookup } from '../types';

let PORTS: number[] = [];

export const addPort = (port: number) => {
  if (!PORTS.includes(port)) {
    PORTS.push(port);
  }
};

export const getPorts = () => {
  return PORTS.slice();
};

export const clearPorts = () => {
  PORTS.splice(0, PORTS.length);
};

export const getFreePort = (): number[] => {
  if (PORTS.length === 0) {
    throw new Error('No more available port left.');
  }

  return PORTS.splice(0, 1);
};

export const findPorts = (portLookup: PortLookup = { from: 3000, to: 3010, address: 'localhost' }): Promise<number[]> => {
  const { from, to, address } = portLookup;

  return fp(from, to, address, to - from).then((ports) => {
    PORTS = ports;
    return PORTS;
  });
};
