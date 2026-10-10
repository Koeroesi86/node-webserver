import { isIPv6 } from 'net';

/** an IPv4 address that reached a dual stack socket as `::ffff:1.2.3.4`, as the IPv4 address it is */
const unmapAddress = (address: string): string =>
  isIPv6(address) && address.toLowerCase().startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address;

export default unmapAddress;
