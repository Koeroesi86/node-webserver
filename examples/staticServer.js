const minimist = require('minimist');
const express = require('express');
const {resolve} = require('path');

const {path, port} = minimist(process.argv.slice(2));

// create main app
const staticApp = express();

// staticApp.get('/', function (req, res) { res.redirect('/index.html') });

staticApp.use(express.static(resolve(path)));

// staticApp.use(express.static(path));

staticApp.listen(port);

console.log(`Providing static files to "${resolve(path)}" on port ${port}`);


