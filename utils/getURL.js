const { DEFAULT_PORTS } = require("../constants");

function getURL(protocol, hostname, port) {
  let displayedPort = port ? `:${port}` : '';

  if (DEFAULT_PORTS[protocol] === port) {
    displayedPort = '';
  }

  return `${protocol}://${hostname}${displayedPort}`;
}

module.exports = getURL;
