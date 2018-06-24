function exitHandler(instances) {
    instances.forEach(instance => {
        const {child} = instance;

        child.kill('SIGTERM');
    });

    process.exit(0);
}

function addExitListeners(instances) {
    process.stdin.resume();

    // do something when app is closing
    process.on('exit', () => exitHandler(instances));

    // catches ctrl+c event
    process.on('SIGINT', () => exitHandler(instances));

    process.on('SIGHUP', () => exitHandler(instances));
    process.on('SIGTERM', () => exitHandler(instances));

    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', () => exitHandler(instances));
    process.on('SIGUSR2', () => exitHandler(instances));

    //catches uncaught exceptions
    process.on('uncaughtException', () => exitHandler(instances));

}

module.exports = addExitListeners;