const http = require('http');
const vhost = require('vhost');
const express = require('express');

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
            console.info(`HTTP server started for ${hostname}`);
            break;
        case 'https':
            addHandler({
                server: httpsServer,
                proxy,
                hostname,
                proxyTarget
            });
            console.info(`HTTPS server started for ${hostname}`);
            break;
        default:
            console.info(`unknown protocol ${protocol} for ${hostname}`);

    }

    return instance;
}

module.exports = function setupVirtualHosts(instances, app) {
    instances.map(instance => setupVirtualHost(instance, app));

    httpServer.listen(80);
    httpsServer.listen(443);
};