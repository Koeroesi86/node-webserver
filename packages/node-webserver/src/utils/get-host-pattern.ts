/** the pattern of a host name with wildcards, built the way `vhost` builds it so that the same hosts match: `*` is one label, the rest is literal */
function getHostPattern(hostname: string): RegExp {
  const source = hostname.replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1').replace(/\*/g, '([^.]+)');

  return new RegExp(`^${source}$`, 'i');
}

export default getHostPattern;
