const readline = require('readline');

let t;
const writeLine = () => {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0, null);

  process.stdout.write(`Current time: ${new Date().toLocaleTimeString()}`);
  t = setTimeout(writeLine, 1000);
};
writeLine();

process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);

process.stdin.on('data', (data) => {
  if (['\r', '\u0003', 'q'].includes(data)) {
    clearTimeout(t);
    console.log('\nThanks for trying.');
    process.exit();
  }
});
