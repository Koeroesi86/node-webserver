const {resolve} = require('path');

module.exports.SERVICE_NAME = 'node-webserver';

module.exports.PORTS = {
    http: 80,
    https: 443
};

module.exports.PORT_LOOKUP = {
    from: 3000,
    to: 3010,
    address: 'localhost'
};

module.exports.SERVERS = [
    {
        serverOptions: {
            hostname: 'some.localhost', //defines what host to provide the instance for
            protocol: 'http', //defines what protocol to use. http/https
            // if proxyOptions doesn't have port, this will be generated
            // proxyTarget: 'http://localhost:8888'
        },
        childOptions: {
            command: 'node',
            args: (port) => [
                resolve('examples/staticServer.js'),
                `--port=${port}`,
                '--path=examples/static'
            ]
        },
        proxyOptions: {
            target: {
                // hostname: 'localhost',
                // port: '8888'
            }
        },
    }
];