const minimist = require('minimist');
const express = require('express');
const {resolve} = require('path');

const {path, port} = minimist(process.argv.slice(2));

// create main app
const staticApp = express();

staticApp.use(express.static(resolve(path)));

staticApp.listen(port);

console.log(`Providing static files to "${resolve(path)}" on port ${port}`);


