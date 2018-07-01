const minimist = require('minimist');
const express = require('express');
const {resolve} = require('path');

const {path, port} = minimist(process.argv.slice(2));

if(!port || !path) {
    throw new Error("Both port and path should be specified to serve.");
}

const resolved = resolve(path);

// create main app
const staticApp = express();

staticApp.use(express.static(resolved));

staticApp.disable('x-powered-by');

staticApp.listen(port);

console.log(`Providing static files to "${resolved}" on port ${port}`);


