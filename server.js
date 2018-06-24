const {SERVERS} = require('./configuration');
const spawnProcesses = require('./utils/spawnProcesses');
const setupChildListeners = require('./utils/setupChildListeners');
const setupVirtualHosts = require('./utils/setupVirtualHosts');
const {findPorts} = require('./utils/ports');

process.chdir(__dirname);

findPorts()
    .then(() => {
        /** @var {Array} instances */
        const instances = spawnProcesses(SERVERS);

        /** stdout listeners setup */
        setupChildListeners(instances);

        /** proxy listener vhosts */
        setupVirtualHosts(instances);
    })
    .catch(error => {
        console.error(error);
    });