const vhost = require('vhost');
const express = require('express');
const {PORTS} = require('../configuration');

const httpServer = express();
const httpsServer = express();

function addHandler({server, proxy, hostname, proxyTarget}) {
    server.use(
        vhost(hostname, (req, res) => {
            proxy.web(req, res, {
                target: proxyTarget
            });
        })
    );
}

function getURL(protocol, hostname, port) {
    return `${protocol}://${hostname}` + (port ? `:${port}` : '');
}

function setupVirtualHost(instance) {
    const {
        serverOptions: {
            hostname,
            protocol,
            proxyTarget
        },
        proxy
    } = instance;

    switch (protocol) {
        case 'http':
            addHandler({
                server: httpServer,
                proxy,
                hostname,
                proxyTarget
            });
            console.info(`Server started for ${getURL(protocol, hostname, PORTS.http)}`);
            break;
        case 'https':
            addHandler({
                server: httpsServer,
                proxy,
                hostname,
                proxyTarget
            });
            console.info(`Server started for ${getURL(protocol, hostname, PORTS.https)}`);
            break;
        default:
            console.info(`unknown protocol ${protocol} for ${hostname}`);

    }

    return instance;
}

module.exports = function setupVirtualHosts(instances, app) {
    instances.map(instance => setupVirtualHost(instance, app));

    httpServer.listen(PORTS.http);
    httpsServer.listen(PORTS.https);
};