const {SERVERS} = require('./configuration');
const spawnProcesses = require('./utils/spawnProcesses');
const setupChildListeners = require('./utils/setupChildListeners');
const setupVirtualHosts = require('./utils/setupVirtualHosts');

/** spawn child processes */
const instances = spawnProcesses(SERVERS);

/** stdout listeners setup */
setupChildListeners(instances);

/** proxy listener vhosts */
setupVirtualHosts(instances);