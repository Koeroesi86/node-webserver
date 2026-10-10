import { BlockList, isIP } from 'net';
import unmapAddress from './unmap-address';

// what a registered target must not point at unless the host allows it: the server itself, the networks behind it and the metadata services of the providers
const nonPublic = new BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => nonPublic.addSubnet(`${network}`, Number(prefix), 'ipv4'));
[
  // unspecified, loopback and the IPv4 compatible ones
  ['::', 96],
  // NAT64, which reaches any IPv4 address (IPv4 addresses in IPv6 form, ::ffff:7f00:1 too, are checked by the IPv4 rules by the block list itself)
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([network, prefix]) => nonPublic.addSubnet(`${network}`, Number(prefix), 'ipv6'));

/** whether an IP address is reachable on the internet, an IPv4 address in IPv6 form included. A name is not an address. */
const isPublicAddress = (address: string): boolean => {
  const unmapped = unmapAddress(address);
  const version = isIP(unmapped);

  if (version === 0) return false;

  return !nonPublic.check(unmapped, version === 4 ? 'ipv4' : 'ipv6');
};

export default isPublicAddress;
