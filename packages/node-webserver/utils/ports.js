const fp = require('find-free-port');

let PORTS = [];

const addPort = (port) => {
  if (!PORTS.includes(port)) {
    PORTS.push(port);
  }
};

module.exports.addPort = addPort;

const getPorts = () => {
  return PORTS.slice();
};

module.exports.getPorts = getPorts;

const clearPorts = () => {
  PORTS.splice(0, PORTS.length);
};

module.exports.clearPorts = clearPorts;

const getFreePort = () => {
  if (PORTS.length > 0) {
    return PORTS.splice(0, 1);
  } else {
    throw new Error("No more available port left.");
  }
};

module.exports.getFreePort = getFreePort;

/** return Promise */
const findPorts = (portLookup = { from: 3000, to: 3010, address: 'localhost' }) => {
  const { from, to, address } = portLookup;

  return new Promise((resolve, reject) => {
    fp(from, to, address, to - from)
      .then(ports => {
        PORTS = ports;
        resolve(PORTS);
      })
      .catch(err => reject(err));
  });
};

module.exports.findPorts = findPorts;
