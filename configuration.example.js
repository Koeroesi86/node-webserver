const {resolve} = require('path');

module.exports = [
    {
        serverOptions: {
            hostname: 'localhost', //defines what host to provide the instance for
            protocol: 'http', //defines what protocol to use. http/https
            proxyTarget: 'http://localhost:8888'
        },
        childOptions: {
            command: 'node',
            args: [
                resolve('examples/staticServer.js'),
                '--port=8888',
                '--path=examples/static'
            ]
        },
        proxyOptions: {
            target: {
                hostname: 'localhost',
                port: '8888'
            }
        },
    }
];