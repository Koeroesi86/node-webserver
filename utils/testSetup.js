const { resolve } = require('path');
const fs = require('fs');
const Jasmine = require('jasmine');
const JasmineConsoleReporter = require('jasmine-console-reporter');

process.chdir(__dirname);

const jasmine = new Jasmine();
const configurationPath = resolve('../configuration.js');
const configurationExamplePath = resolve('../configuration.example.js');

// create config for build
if (!fs.existsSync(configurationPath)) {
  // copy example for now
  fs.copyFileSync(configurationExamplePath, configurationPath);
}

jasmine.loadConfig({
  random: false,
  spec_files: [
    '*.test.js'
  ]
});

const reporter = new JasmineConsoleReporter({
  colors: 1,           // (0|false)|(1|true)|2
  cleanStack: 1,       // (0|false)|(1|true)|2|3
  verbosity: 4,        // (0|false)|1|2|(3|true)|4
  listStyle: 'indent', // "flat"|"indent"
  activity: 'dots',     // boolean or string ("dots"|"star"|"flip"|"bouncingBar"|...)
  emoji: true,
  beep: false
});

jasmine.env.clearReporters();
jasmine.addReporter(reporter);

jasmine.execute();
