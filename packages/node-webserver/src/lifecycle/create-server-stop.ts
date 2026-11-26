import type net from 'net';
import createGracefulStop from './create-graceful-stop';
import type { LoadedInstance } from '../types';

/** the soft stop of a whole server: its listening servers first, then what runs behind them. It tracks the connections from the moment it is created. */
const createServerStop = (servers: net.Server[], getLoaded: () => LoadedInstance[]) =>
  createGracefulStop(servers, (timeout) => Promise.all(getLoaded().map(({ close }) => close(timeout))).then(() => undefined));

export default createServerStop;
