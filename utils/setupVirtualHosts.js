const http = require('http');
const vhost = require('vhost');

function setupVirtualHost(instance) {
    const {
        serverOptions: {
            hostname,
            port,
            proxyTarget
        },
        proxy
    } = instance;

    http.createServer(
        vhost(hostname, (req, res) => {
            proxy.web(req, res, {
                target: proxyTarget
            });
        })
    ).listen(port);

    return instance;
}

module.exports = function setupVirtualHosts(instances, app) {
    instances.map(instance => setupVirtualHost(instance, app));
};