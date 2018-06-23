const service = require('os-service');
const minimist = require('minimist');
const {resolve} = require('path');
const {SERVICE_NAME} = require('../configuration');
const {spawn} = require('child_process');

const {add, remove, run} = minimist(process.argv.slice(2));

let child;

if (add) {
    service.add(SERVICE_NAME, {
        programArgs: ["--run"]
    }, function (error) {
        if (error) {
            console.trace(error);
        }
    });
} else if (remove) {
    service.remove(SERVICE_NAME, function (error) {
        if (error) {
            console.trace(error);
        }
    });
} else if (run) {
    service.run(function () {
        if (child) {
            child.stdin.pause();
            child.kill();
            child = null;
        }
        service.stop(0);
    });

    child = spawn('node', [resolve('../server.js')]);


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