const service = require('os-service');
const minimist = require('minimist');
const {resolve} = require('path');
const {SERVICE_NAME} = require('../configuration');

const {add, remove, run} = minimist(process.argv.slice(2));

if (add) {
    service.add(SERVICE_NAME, {programPath: resolve('../server.js')}, function(error){
        if (error) {
            console.trace(error);
        }
    });
} else if (remove) {
    service.remove(SERVICE_NAME, function(error){
        if (error) {
            console.trace(error);
        }
    });
} else if (run) {
    service.run(function () {
        service.stop(0);
    });
} else {
    console.info(`
    Usage:
    
    yarn run service [argument]
    
    arguments:
        --add      Installs the service
        --remove   Removes the service
        --run      Attempt to run the program as a service
    `)
}