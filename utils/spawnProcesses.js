const {spawn} = require('child_process');

/** https://github.com/nodejitsu/node-http-proxy */
const HttpProxy = require('http-proxy');

function spawnProcess(config) {
    const {
        childOptions: {command, args},
        proxyOptions,
        serverOptions
    } = config;
    const child = spawn(command, args);

    const proxy = new HttpProxy.createProxyServer(proxyOptions);

    return {proxy, child, serverOptions};
}

module.exports.spawnProcess = spawnProcess;

module.exports = function spawnProcesses(configs) {
    return configs.slice().map(config => spawnProcess(config))
};