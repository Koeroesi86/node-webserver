const {spawn} = require('child_process');

/** https://github.com/nodejitsu/node-http-proxy */
const HttpProxy = require('http-proxy');

const {getFreePort} = require('./ports');

function spawnProcess(config) {
    const {
        childOptions: {command, args},
        proxyOptions,
        serverOptions
    } = config;

    let childArgs = args;

    if(!proxyOptions.port) {
        const port = getFreePort();
        proxyOptions.port = port;

        if(typeof childArgs === 'function') {
            childArgs = childArgs(port);
        }

        serverOptions.proxyTarget = `${serverOptions.protocol}://127.0.0.1:${port}`;
    }
    const child = spawn(command, childArgs);

    const proxy = new HttpProxy.createProxyServer(proxyOptions);

    return {proxy, child, serverOptions};
}

module.exports.spawnProcess = spawnProcess;

module.exports = function spawnProcesses(configs) {
    return configs.slice().map(config => spawnProcess(config))
};