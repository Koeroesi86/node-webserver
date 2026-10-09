/** the host name of a `Host` header, without the port, in lower case. IPv6 addresses keep their brackets. */
function getHostname(host?: string): string | undefined {
  if (!host) {
    return undefined;
  }

  const portSeparator = host.indexOf(':', host.startsWith('[') ? host.indexOf(']') + 1 : 0);

  return (portSeparator === -1 ? host : host.substring(0, portSeparator)).toLowerCase();
}

export default getHostname;
