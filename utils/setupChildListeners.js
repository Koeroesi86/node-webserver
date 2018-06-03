module.exports = function setupChildListeners(instances) {
    instances.forEach(instance => {
        const {child} = instance;

        child.stdout.on('data', (data) => {
            console.info(`stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            console.warn(`stderr: ${data}`);
        });

        child.on('close', (code) => {
            console.error(`child process exited with code ${code}`);
        });
    });
};