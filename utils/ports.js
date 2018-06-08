const fp = require('find-free-port');
const {PORT_LOOKUP} = require('../configuration');

let PORTS = [];

const getFreePort = () => {
    if (PORTS.length > 0) {
        return PORTS.splice(0, 1);
    } else {
        throw new Error("No more available port left.");
    }
};

module.exports.getFreePort = getFreePort;

/** return Promise */
const findPorts = () => {
    const {from, to, address} = PORT_LOOKUP;

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
