const fp = require('find-free-port');

const FROM_PORT = 3000;
const TO_PORT = 3010;
const ADDRESS = '127.0.0.1';

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
    return new Promise((resolve, reject) => {
        fp(FROM_PORT, TO_PORT, ADDRESS, TO_PORT - FROM_PORT)
            .then(ports => {
                PORTS = ports;
                resolve(PORTS);
            })
            .catch(err => reject(err));
    });
};

module.exports.findPorts = findPorts;
